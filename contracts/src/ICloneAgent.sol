// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Canonical ERC-6551 registry (same address on every chain, incl. Base).
interface IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address);

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address);
}

/**
 * @title  iCLONE Agent (iNFT)
 * @notice The NFT *is* the agent, the key, and the vault. Each token carries a
 *         permanent Irys metadata link (the tokenURI sealed in iIrys Frame), pays a
 *         perpetual ERC-2981 royalty to the project treasury, and owns an
 *         ERC-6551 token-bound account (its agent wallet).
 *
 *         Built for Base (chainId 8453). Mint authorisation is configurable:
 *         owner/minters can always mint; public minting is off until enabled.
 */
contract ICloneAgent is ERC721A, ERC2981, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    // ── configuration ────────────────────────────────────────────────────────
    uint256 public maxSupply; // 0 = unlimited
    uint256 public mintPrice; // wei charged to public minters (owner/minters free)
    bool public publicMint; // when false, only owner + minters may mint
    mapping(address => bool) public minters;

    /// per-token Irys metadata URI (the mint link from iIrys Frame)
    mapping(uint256 => string) private _tokenURIs;

    // ── phased signed mint (allowlist launch) ─────────────────────────────────
    // The launch gate is a voucher signed off-chain by `mintSigner` for wallets
    // on the allowlist. One signature authorises ONE mint and pins everything
    // that matters — wallet, phase, price, per-phase cap, the tokenURI itself
    // (as a hash), and an expiry — so the public can never mint arbitrary
    // metadata into the collection, with `publicMint` staying off forever.
    /// dedicated signing key for mint vouchers — never the owner/deployer key
    address public mintSigner;

    struct Phase {
        uint64 start; // unix; 0 = phase not configured
        uint64 end; // unix; 0 = no end
    }

    /// phase id (1..4) → live window
    mapping(uint8 => Phase) public phases;

    /// voucher digest → consumed (one voucher, one mint)
    mapping(bytes32 => bool) public voucherUsed;

    uint8 internal constant MAX_PHASE = 4; // per-wallet counters pack 4×uint16 in ERC721A aux

    bytes32 internal constant VOUCHER_TYPEHASH = keccak256(
        "MintVoucher(address to,uint8 phase,uint256 price,uint32 cap,uint256 deadline,bytes32 uriHash,uint256 nonce)"
    );

    /// ERC-7572 contract-level metadata (collection name/description/image on Irys)
    string private _contractURI;

    // ── ERC-6551 (token-bound accounts) ───────────────────────────────────────
    address public immutable erc6551Registry;
    address public erc6551Implementation;

    // ── events ────────────────────────────────────────────────────────────────
    event Minted(address indexed to, uint256 indexed tokenId, string uri);
    event SignedMinted(address indexed to, uint256 indexed tokenId, uint8 indexed phase, uint256 price);
    event MintSignerUpdated(address indexed signer);
    event PhaseUpdated(uint8 indexed phase, uint64 start, uint64 end);
    /// ERC-7572
    event ContractURIUpdated();
    event TokenURIUpdated(uint256 indexed tokenId, string uri);
    event MintPriceUpdated(uint256 price);
    event MaxSupplyUpdated(uint256 supply);
    event PublicMintUpdated(bool enabled);
    event MinterUpdated(address indexed minter, bool allowed);
    event ImplementationUpdated(address implementation);
    event Withdrawn(address indexed to, uint256 amount);

    // ── errors ────────────────────────────────────────────────────────────────
    error EmptyURI();
    error MaxSupplyReached();
    error MaxSupplyBelowMinted();
    error WrongPayment(uint256 sent, uint256 required);
    error NotAuthorized();
    error NonexistentToken();
    error NoBalance();
    error WithdrawFailed();
    error ZeroAddress();
    error SignerNotSet();
    error InvalidSignature();
    error InvalidPhase(uint8 phase);
    error PhaseClosed(uint8 phase);
    error VoucherExpired(uint256 deadline);
    error VoucherAlreadyUsed();
    error UriMismatch();
    error PhaseCapReached(uint8 phase, uint32 cap);

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        address registry_,
        address implementation_
    ) ERC721A(name_, symbol_) Ownable(owner_) EIP712("ICloneAgent", "1") {
        if (owner_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_); // ERC2981 caps bps at 10000
        erc6551Registry = registry_;
        erc6551Implementation = implementation_;
        minters[owner_] = true;
        emit MinterUpdated(owner_, true);
    }

    /// tokenIds start at 1 (0 is reserved / "none")
    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    // ── minting ────────────────────────────────────────────────────────────────
    /**
     * @notice Mint one agent NFT to `to` with its permanent Irys `uri` (tokenURI).
     * @dev    Owner/minters mint for free; public minters (when enabled) pay
     *         `mintPrice`. Returns the new tokenId. Matches iIrys Frame's
     *         mint(address,string) signature.
     */
    function mint(address to, string calldata uri)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(uri).length == 0) revert EmptyURI();

        bool privileged = (msg.sender == owner() || minters[msg.sender]);
        if (!publicMint && !privileged) revert NotAuthorized();

        uint256 required = privileged ? 0 : mintPrice;
        if (msg.value != required) revert WrongPayment(msg.value, required);

        tokenId = _nextTokenId();
        if (maxSupply != 0 && tokenId > maxSupply) revert MaxSupplyReached();

        _tokenURIs[tokenId] = uri;
        _mint(to, 1);
        emit Minted(to, tokenId, uri);
    }

    /**
     * @notice Allowlist/public launch mint: one EIP-712 voucher from `mintSigner`
     *         authorises exactly one mint of exactly `uri` to exactly `to`.
     * @dev    Anyone may SUBMIT the transaction (gasless relaying stays possible),
     *         but the token always lands on the voucher's `to` and the payment is
     *         the voucher's `price` — nothing is caller-controlled, so there is
     *         nothing for a bot to front-run but its own gas. No tx.origin games:
     *         smart wallets (ERC-4337) mint like anyone else.
     */
    struct MintVoucher {
        address to; // allowlisted wallet — the token always lands here
        uint8 phase; // 1 = allowlist, 2 = public (3,4 reserved)
        uint256 price; // exact wei this wallet pays
        uint32 cap; // max voucher mints for `to` in this phase
        uint256 deadline; // unix expiry of the signature
        bytes32 uriHash; // keccak256(bytes(uri)) — pins the metadata
        uint256 nonce; // unique per voucher; one voucher = one mint
    }

    function mintSigned(MintVoucher calldata v, string calldata uri, bytes calldata sig)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        if (v.to == address(0)) revert ZeroAddress();
        if (bytes(uri).length == 0) revert EmptyURI();
        if (mintSigner == address(0)) revert SignerNotSet();
        if (v.phase == 0 || v.phase > MAX_PHASE) revert InvalidPhase(v.phase);

        Phase memory p = phases[v.phase];
        if (p.start == 0 || block.timestamp < p.start || (p.end != 0 && block.timestamp > p.end)) {
            revert PhaseClosed(v.phase);
        }
        if (block.timestamp > v.deadline) revert VoucherExpired(v.deadline);
        if (msg.value != v.price) revert WrongPayment(msg.value, v.price);
        if (keccak256(bytes(uri)) != v.uriHash) revert UriMismatch();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, v.to, v.phase, v.price, v.cap, v.deadline, v.uriHash, v.nonce))
        );
        if (ECDSA.recover(digest, sig) != mintSigner) revert InvalidSignature();
        if (voucherUsed[digest]) revert VoucherAlreadyUsed();
        voucherUsed[digest] = true;

        // per-phase, per-wallet counter — ERC721A's aux packs 4×uint16, so phase
        // counters never bleed into each other (or into lifetime _numberMinted)
        uint64 aux = _getAux(v.to);
        uint256 shift = (uint256(v.phase) - 1) << 4;
        if (uint32((aux >> shift) & 0xffff) >= v.cap) revert PhaseCapReached(v.phase, v.cap);
        _setAux(v.to, aux + uint64(1 << shift));

        tokenId = _nextTokenId();
        if (maxSupply != 0 && tokenId > maxSupply) revert MaxSupplyReached();

        _tokenURIs[tokenId] = uri;
        _mint(v.to, 1);
        emit Minted(v.to, tokenId, uri);
        emit SignedMinted(v.to, tokenId, v.phase, v.price);
    }

    /// @notice How many tokens `wallet` has minted in `phase` (1..4) via vouchers.
    function phaseMinted(address wallet, uint8 phase) external view returns (uint32) {
        if (phase == 0 || phase > MAX_PHASE) revert InvalidPhase(phase);
        return uint32((_getAux(wallet) >> ((uint256(phase) - 1) << 4)) & 0xffff);
    }

    // ── metadata ────────────────────────────────────────────────────────────────
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert NonexistentToken();
        return _tokenURIs[tokenId];
    }

    /// @notice Update a token's Irys link (e.g. evolving iNFT art via a new seal).
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        if (!_exists(tokenId)) revert NonexistentToken();
        if (bytes(uri).length == 0) revert EmptyURI();
        _tokenURIs[tokenId] = uri;
        emit TokenURIUpdated(tokenId, uri);
    }

    /// @notice ERC-7572 collection-level metadata (marketplaces read this for
    ///         name/description/image before any manual branding).
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractURI = uri;
        emit ContractURIUpdated();
    }

    // ── ERC-6551 token-bound account (the agent's vault wallet) ──────────────────
    function tokenAccount(uint256 tokenId) external view returns (address) {
        return IERC6551Registry(erc6551Registry)
            .account(erc6551Implementation, bytes32(0), block.chainid, address(this), tokenId);
    }

    function createTokenAccount(uint256 tokenId) external returns (address) {
        if (!_exists(tokenId)) revert NonexistentToken();
        return IERC6551Registry(erc6551Registry)
            .createAccount(erc6551Implementation, bytes32(0), block.chainid, address(this), tokenId);
    }

    // ── admin ────────────────────────────────────────────────────────────────────
    function setMintPrice(uint256 price) external onlyOwner {
        mintPrice = price;
        emit MintPriceUpdated(price);
    }

    function setMaxSupply(uint256 supply) external onlyOwner {
        if (supply != 0 && supply < _totalMinted()) revert MaxSupplyBelowMinted();
        maxSupply = supply;
        emit MaxSupplyUpdated(supply);
    }

    function setPublicMint(bool enabled) external onlyOwner {
        publicMint = enabled;
        emit PublicMintUpdated(enabled);
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    /// @notice Rotate the voucher signing key. Rotating instantly invalidates
    ///         every signature the old key ever produced (compromise response).
    function setMintSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        mintSigner = signer;
        emit MintSignerUpdated(signer);
    }

    /// @notice Open/close a mint phase window. start=0 disables the phase;
    ///         end=0 means no scheduled end.
    function setPhase(uint8 phase, uint64 start, uint64 end) external onlyOwner {
        if (phase == 0 || phase > MAX_PHASE) revert InvalidPhase(phase);
        phases[phase] = Phase(start, end);
        emit PhaseUpdated(phase, start, end);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(receiver, bps);
    }

    function setImplementation(address implementation) external onlyOwner {
        erc6551Implementation = implementation;
        emit ImplementationUpdated(implementation);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalance();
        (bool ok,) = to.call{value: balance}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, balance);
    }

    // ── views / overrides ────────────────────────────────────────────────────────
    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721A, ERC2981) returns (bool) {
        return ERC721A.supportsInterface(interfaceId) || ERC2981.supportsInterface(interfaceId);
    }
}

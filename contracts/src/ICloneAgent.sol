// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
contract ICloneAgent is ERC721A, ERC2981, Ownable2Step, Pausable, ReentrancyGuard {
    // ── configuration ────────────────────────────────────────────────────────
    uint256 public maxSupply; // 0 = unlimited
    uint256 public mintPrice; // wei charged to public minters (owner/minters free)
    bool public publicMint; // when false, only owner + minters may mint
    mapping(address => bool) public minters;

    /// per-token Irys metadata URI (the mint link from iIrys Frame)
    mapping(uint256 => string) private _tokenURIs;

    // ── ERC-6551 (token-bound accounts) ───────────────────────────────────────
    address public immutable erc6551Registry;
    address public erc6551Implementation;

    // ── events ────────────────────────────────────────────────────────────────
    event Minted(address indexed to, uint256 indexed tokenId, string uri);
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

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        address registry_,
        address implementation_
    ) ERC721A(name_, symbol_) Ownable(owner_) {
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

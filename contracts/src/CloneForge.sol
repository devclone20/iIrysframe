// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721A} from "erc721a/contracts/ERC721A.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {FrameRoyaltySplit} from "./FrameRoyaltySplit.sol";

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
 * @title  CloneForge — configurable iNFT drop contract (iIrys Frame ENGINE)
 * @notice One precompiled contract, every knob a constructor arg or owner setter,
 *         so collections deploy straight from the iIrys Frame app (no Remix):
 *
 *         · per-token Irys tokenURI (owner mints sealed items — the curated path)
 *         · drop mode: `dropBaseURI` + sequential `mintDrop(qty)` for public drops
 *           (public minters can never choose the URI)
 *         · ERC-2981 perpetual royalty
 *         · optional max supply, mint price, per-wallet limit
 *         · optional OG-card gate: only holders of the OG NFT may public-mint
 *         · `contractURI()` — collection profile JSON sealed on Irys (OpenSea)
 *         · ERC-6551 token-bound account per token (agent wallet), optional
 */
contract CloneForge is ERC721A, ERC2981, Ownable2Step, Pausable, ReentrancyGuard {
    using Strings for uint256;

    /// Optional developer-support fee. None = no fee (default). FirstSale = a cut
    /// of each paid primary mint. Perpetual = a cut of every secondary trade,
    /// forever, via an immutable splitter set as the ERC-2981 receiver.
    enum SupportMode {
        None, // 0
        FirstSale, // 1
        Perpetual // 2
    }

    uint96 private constant DEV_BPS_MIN = 100; // 1%
    uint96 private constant DEV_BPS_MAX = 500; // 5%
    uint96 private constant MAX_TOTAL_ROYALTY_BPS = 1000; // creator + dev ≤ 10% (perpetual)

    // ── configuration ─────────────────────────────────────────────────────────
    struct Config {
        string name;
        string symbol;
        address owner;
        address royaltyReceiver;
        uint96 royaltyBps; // 500 = 5%
        uint256 maxSupply; // 0 = unlimited
        uint256 mintPrice; // wei per public mint (owner/minters free)
        bool publicMint; // public minting enabled at launch?
        uint256 walletLimit; // 0 = unlimited public mints per wallet
        address ogCard; // 0 = open to everyone; else must hold this ERC-721
        string contractURI_; // Irys link to the collection profile JSON (OpenSea)
        string dropBaseURI; // "" = per-token URIs only; else tokenURI = base + id
        address erc6551Registry; // 0 = token-bound accounts disabled
        address erc6551Implementation;
        address developer; // dev wallet for the optional support fee (0 when None)
        uint96 devBps; // 0, or 100..500 (1%..5%)
        SupportMode supportMode; // None / FirstSale / Perpetual
    }

    uint256 public maxSupply;
    uint256 public mintPrice;
    bool public publicMint;
    uint256 public walletLimit;
    address public ogCard;
    string private _contractURI;
    string public dropBaseURI;
    mapping(address => bool) public minters;
    mapping(address => uint256) public publicMinted; // per-wallet public mint count

    /// per-token Irys metadata URI (overrides dropBaseURI when set)
    mapping(uint256 => string) private _tokenURIs;

    // ── ERC-6551 (token-bound accounts) ───────────────────────────────────────
    address public erc6551Registry;
    address public erc6551Implementation;

    // ── developer support fee (optional) ──────────────────────────────────────
    address public developer; // receives the support fee (0 when mode = None)
    uint96 public devBps; // 0, or 100..500 (1%..5%)
    SupportMode public supportMode;
    address public royaltySplit; // FrameRoyaltySplit when Perpetual, else address(0)
    uint256 public devAccrued; // FirstSale: dev's pull-able cut of primary revenue

    // ── events ─────────────────────────────────────────────────────────────────
    event Minted(address indexed to, uint256 indexed tokenId, string uri);
    /// ERC-4906 — marketplaces re-index metadata automatically on these
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event DropMinted(address indexed to, uint256 firstTokenId, uint256 quantity);
    event TokenURIUpdated(uint256 indexed tokenId, string uri);
    event MintPriceUpdated(uint256 price);
    event MaxSupplyUpdated(uint256 supply);
    event PublicMintUpdated(bool enabled);
    event WalletLimitUpdated(uint256 limit);
    event OgCardUpdated(address ogCard);
    event ContractURIUpdated(string uri);
    event DropBaseURIUpdated(string uri);
    event MinterUpdated(address indexed minter, bool allowed);
    event Withdrawn(address indexed to, uint256 amount);
    event DevWithdrawn(address indexed developer, uint256 amount);
    event SupportConfigured(SupportMode mode, address developer, uint96 devBps, address split);

    // ── errors ─────────────────────────────────────────────────────────────────
    error EmptyURI();
    error MaxSupplyReached();
    error MaxSupplyBelowMinted();
    error WrongPayment(uint256 sent, uint256 required);
    error NotAuthorized();
    error OgCardRequired();
    error WalletLimitReached();
    error DropNotConfigured();
    error NonexistentToken();
    error ZeroQuantity();
    error NoBalance();
    error WithdrawFailed();
    error ZeroAddress();
    error BadDevConfig();
    error RoyaltyTooHigh();
    error RoyaltyLocked();

    constructor(Config memory c) ERC721A(c.name, c.symbol) Ownable(c.owner) {
        if (c.owner == address(0) || c.royaltyReceiver == address(0)) revert ZeroAddress();

        // ── royalty + optional developer-support fee ──────────────────────────
        supportMode = c.supportMode;
        if (c.supportMode == SupportMode.None) {
            if (c.devBps != 0) revert BadDevConfig();
            _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps); // creator only
        } else {
            if (c.developer == address(0)) revert ZeroAddress();
            if (c.devBps < DEV_BPS_MIN || c.devBps > DEV_BPS_MAX) revert BadDevConfig();
            developer = c.developer;
            devBps = c.devBps;
            if (c.supportMode == SupportMode.FirstSale) {
                _setDefaultRoyalty(c.royaltyReceiver, c.royaltyBps); // secondary = creator only
            } else {
                // Perpetual: deploy an immutable splitter as the sole ERC-2981 receiver.
                if (uint256(c.royaltyBps) + c.devBps > MAX_TOTAL_ROYALTY_BPS) revert RoyaltyTooHigh();
                FrameRoyaltySplit split = new FrameRoyaltySplit(c.royaltyReceiver, c.developer, c.royaltyBps, c.devBps);
                royaltySplit = address(split);
                _setDefaultRoyalty(address(split), uint96(uint256(c.royaltyBps) + c.devBps));
            }
            emit SupportConfigured(c.supportMode, developer, devBps, royaltySplit);
        }

        maxSupply = c.maxSupply;
        mintPrice = c.mintPrice;
        publicMint = c.publicMint;
        walletLimit = c.walletLimit;
        ogCard = c.ogCard;
        _contractURI = c.contractURI_;
        dropBaseURI = c.dropBaseURI;
        erc6551Registry = c.erc6551Registry;
        erc6551Implementation = c.erc6551Implementation;
        minters[c.owner] = true;
        emit MinterUpdated(c.owner, true);
    }

    /// tokenIds start at 1 (0 is reserved / "none")
    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    // ── minting · curated (explicit sealed URI) ────────────────────────────────
    /**
     * @notice Mint one NFT with its permanent Irys `uri`. Owner/minters mint free;
     *         the public (when enabled) pays `mintPrice` and passes the OG gate.
     *         Matches iIrys Frame's mint(address,string) signature.
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
        if (!privileged) _checkPublicGate(1);

        uint256 required = privileged ? 0 : mintPrice;
        if (msg.value != required) revert WrongPayment(msg.value, required);

        // FirstSale support: dev accrues a cut of each PAID mint (free mints accrue nothing).
        if (!privileged && supportMode == SupportMode.FirstSale && msg.value != 0) {
            devAccrued += (msg.value * devBps) / 10_000;
        }

        tokenId = _nextTokenId();
        if (maxSupply != 0 && tokenId > maxSupply) revert MaxSupplyReached();

        _tokenURIs[tokenId] = uri;
        if (!privileged) publicMinted[msg.sender] += 1;
        _mint(to, 1);
        emit Minted(to, tokenId, uri);
    }

    // ── minting · drop (sequential, public can never choose the URI) ──────────
    /// @notice Public drop mint: `quantity` sequential tokens served by dropBaseURI.
    function mintDrop(uint256 quantity) external payable whenNotPaused nonReentrant {
        if (quantity == 0) revert ZeroQuantity();
        if (bytes(dropBaseURI).length == 0) revert DropNotConfigured();

        bool privileged = (msg.sender == owner() || minters[msg.sender]);
        if (!privileged) _checkPublicGate(quantity);

        uint256 required = privileged ? 0 : mintPrice * quantity;
        if (msg.value != required) revert WrongPayment(msg.value, required);

        // FirstSale support: dev accrues a cut of each PAID mint (free mints accrue nothing).
        if (!privileged && supportMode == SupportMode.FirstSale && msg.value != 0) {
            devAccrued += (msg.value * devBps) / 10_000;
        }

        uint256 first = _nextTokenId();
        if (maxSupply != 0 && first + quantity - 1 > maxSupply) revert MaxSupplyReached();

        if (!privileged) publicMinted[msg.sender] += quantity;
        _mint(msg.sender, quantity);
        emit DropMinted(msg.sender, first, quantity);
    }

    function _checkPublicGate(uint256 quantity) private view {
        if (!publicMint) revert NotAuthorized();
        if (ogCard != address(0) && IERC721(ogCard).balanceOf(msg.sender) == 0) revert OgCardRequired();
        if (walletLimit != 0 && publicMinted[msg.sender] + quantity > walletLimit) revert WalletLimitReached();
    }

    // ── metadata ────────────────────────────────────────────────────────────────
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert NonexistentToken();
        string memory uri = _tokenURIs[tokenId];
        if (bytes(uri).length != 0) return uri;
        if (bytes(dropBaseURI).length != 0) return string.concat(dropBaseURI, tokenId.toString());
        return "";
    }

    /// @notice Collection profile JSON (sealed on Irys) — read by OpenSea.
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice Update a token's Irys link (e.g. evolving iNFT art via a new seal).
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        if (!_exists(tokenId)) revert NonexistentToken();
        if (bytes(uri).length == 0) revert EmptyURI();
        _tokenURIs[tokenId] = uri;
        emit TokenURIUpdated(tokenId, uri);
        emit MetadataUpdate(tokenId);
    }

    // ── ERC-6551 token-bound account (the agent's vault wallet) ────────────────
    function tokenAccount(uint256 tokenId) external view returns (address) {
        if (erc6551Registry == address(0)) return address(0);
        return IERC6551Registry(erc6551Registry)
            .account(erc6551Implementation, bytes32(0), block.chainid, address(this), tokenId);
    }

    function createTokenAccount(uint256 tokenId) external returns (address) {
        if (!_exists(tokenId)) revert NonexistentToken();
        if (erc6551Registry == address(0)) revert ZeroAddress();
        return IERC6551Registry(erc6551Registry)
            .createAccount(erc6551Implementation, bytes32(0), block.chainid, address(this), tokenId);
    }

    // ── admin ───────────────────────────────────────────────────────────────────
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

    function setWalletLimit(uint256 limit) external onlyOwner {
        walletLimit = limit;
        emit WalletLimitUpdated(limit);
    }

    function setOgCard(address card) external onlyOwner {
        ogCard = card; // zero clears the gate
        emit OgCardUpdated(card);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractURI = uri;
        emit ContractURIUpdated(uri);
    }

    function setDropBaseURI(string calldata uri) external onlyOwner {
        dropBaseURI = uri;
        emit DropBaseURIUpdated(uri);
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        // A perpetual developer-support commitment is immutable — it can't be
        // re-pointed away from the splitter after the collection is live.
        if (supportMode == SupportMode.Perpetual) revert RoyaltyLocked();
        if (receiver == address(0)) revert ZeroAddress();
        _setDefaultRoyalty(receiver, bps);
    }

    function setErc6551(address registry, address implementation) external onlyOwner {
        erc6551Registry = registry;
        erc6551Implementation = implementation;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        // The developer's accrued first-sale cut is reserved — the owner can only
        // withdraw the rest. (devAccrued is always 0 outside FirstSale mode.)
        uint256 ownerShare = address(this).balance - devAccrued;
        if (ownerShare == 0) revert NoBalance();
        (bool ok,) = to.call{value: ownerShare}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, ownerShare);
    }

    /// @notice Pull the developer's accrued first-sale support cut. Pull pattern:
    ///         nothing is ever pushed to the developer in the mint path; anyone
    ///         may trigger this and the funds only ever go to `developer`.
    function withdrawDev() external nonReentrant {
        uint256 amount = devAccrued;
        if (amount == 0) revert NoBalance();
        devAccrued = 0; // effects
        Address.sendValue(payable(developer), amount); // interaction
        emit DevWithdrawn(developer, amount);
    }

    // ── views / overrides ───────────────────────────────────────────────────────
    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _exists(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721A, ERC2981) returns (bool) {
        // 0x49064906 = ERC-4906 (metadata update events)
        return interfaceId == bytes4(0x49064906) || ERC721A.supportsInterface(interfaceId)
            || ERC2981.supportsInterface(interfaceId);
    }
}

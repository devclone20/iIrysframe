// Minting-contract templates for Base. The first is the iCLONE creator contract
// (5% perpetual royalty); the other two are royalty-free base configs the user
// can pick instead. Code is shown verbatim in the Minting Contracts tab.

export interface ContractTemplate {
  id: string;
  name: string;
  symbol: string;
  badge?: string;
  royalty: string;
  mintGate: string; // who can mint
  tagline: string;
  description: string;
  features: string[];
  recommendedFor: string;
  deployedAt?: string; // Base mainnet address if live
  code: string;
}

const ICLONE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  iCLONE Agent — AI-agent NFT with a permanent 5% creator royalty.
/// @notice Each token stores its own Irys tokenURI; the metadata holds the
///         \`ai_soul\` object, so the NFT IS the ownable identity of an AI agent.
///         The 5% royalty (ERC-2981) follows the token on every marketplace sale,
///         forever — paid to the iCLONE creator.
contract ICloneRoyaltyAgent is ERC721URIStorage, ERC2981, Ownable {
    uint256 public nextId = 1;

    constructor(address creator)
        ERC721("iCLONE Agent", "INFT")
        Ownable(creator)
    {
        // 500 bps = 5% perpetual royalty to the creator on secondary sales.
        _setDefaultRoyalty(creator, 500);
    }

    /// @notice Mint an agent whose soul lives at \`uri\` (the Irys metadata link).
    function mint(address to, string calldata uri) external onlyOwner returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        _setTokenURI(id, uri); // tokenURI → ai_soul on Irys
    }

    function supportsInterface(bytes4 id)
        public view override(ERC721URIStorage, ERC2981) returns (bool)
    {
        return super.supportsInterface(id);
    }
}`;

const STANDARD = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  Standard Agent — clean ERC-721, NO royalties.
/// @notice Owner mints each token with its Irys tokenURI (which can carry the
///         \`ai_soul\`). Nothing is taken on secondary sales. Fully your own.
contract StandardAgent is ERC721URIStorage, Ownable {
    uint256 public nextId = 1;

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC721(name_, symbol_)
        Ownable(owner_)
    {}

    function mint(address to, string calldata uri) external onlyOwner returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        _setTokenURI(id, uri);
    }
}`;

const OPEN = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  Open Edition Agent — public mint, NO royalties.
/// @notice Anyone can mint by paying \`price\` (0 = free). Optional \`maxSupply\`.
///         Ideal for community drops where holders self-mint their own agent.
contract OpenAgent is ERC721URIStorage, Ownable {
    uint256 public nextId = 1;
    uint256 public price;      // wei per mint (0 = free)
    uint256 public maxSupply;  // 0 = unlimited

    constructor(string memory name_, string memory symbol_, address owner_, uint256 price_, uint256 maxSupply_)
        ERC721(name_, symbol_)
        Ownable(owner_)
    {
        price = price_;
        maxSupply = maxSupply_;
    }

    /// @notice Public mint — caller pays \`price\` and supplies its Irys tokenURI.
    function mint(string calldata uri) external payable returns (uint256 id) {
        require(msg.value >= price, "underpaid");
        require(maxSupply == 0 || nextId <= maxSupply, "sold out");
        id = nextId++;
        _safeMint(msg.sender, id);
        _setTokenURI(id, uri);
    }

    function setPrice(uint256 p) external onlyOwner { price = p; }
    function withdraw() external onlyOwner { payable(owner()).transfer(address(this).balance); }
}`;

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: "iclone",
    name: "iCLONE Royalty Agent",
    symbol: "INFT",
    badge: "DEVELOPER · 5%",
    royalty: "5% perpetual (ERC-2981) → iCLONE creator",
    mintGate: "Owner / minters (free)",
    tagline: "The developer's contract. Charges 5% on every sale, forever.",
    description:
      "The official iCLONE contract. Each NFT is the identity of an AI agent (ai_soul in the tokenURI). On every secondary sale on a marketplace, 5% goes automatically to the creator, perpetually, via the ERC-2981 royalty standard. It's the recommended option for iCLONE agents — the deployed production version also adds ERC-721A (cheaper batch gas) and ERC-6551 (token-bound accounts).",
    features: [
      "5% perpetual royalty to the creator (ERC-2981, honored by OpenSea/Blur/etc.)",
      "Per-token tokenURI → points to the Irys metadata with the ai_soul",
      "Mint controlled by owner/minters (free for the creator)",
      "Production version: + ERC-721A + ERC-6551 (token-bound accounts)",
    ],
    recommendedFor: "Official iCLONE agents and any collection where you want perpetual royalty income.",
    deployedAt: "0x654F3A60900f79c43f1C47397e9912cEF6F9F78B",
    code: ICLONE,
  },
  {
    id: "standard",
    name: "Standard Agent",
    symbol: "AGENT",
    royalty: "No royalties",
    mintGate: "Owner (free)",
    tagline: "Clean ERC-721, no royalties. Fully yours.",
    description:
      "Standard base config. A simple, clean ERC-721 where the owner mints each token with its Irys tokenURI (which can carry the ai_soul). Nothing is charged on secondary sales. For anyone who wants their own contract, with no third-party royalties.",
    features: [
      "No royalties — nothing is taken on secondary sales",
      "Per-token tokenURI (supports ai_soul)",
      "Owner-only mint",
      "Minimal, auditable, easy to extend",
    ],
    recommendedFor: "Anyone who wants their own clean contract, with no third-party royalties.",
    code: STANDARD,
  },
  {
    id: "open",
    name: "Open Edition Agent",
    symbol: "AGENT",
    royalty: "No royalties",
    mintGate: "Public (pays price, or free)",
    tagline: "Public mint, no royalties. The community mints its own agent.",
    description:
      "Standard base config for community drops. Anyone can mint by paying the set price (0 = free), with optional maxSupply. No royalties. Each holder mints their own agent with their ai_soul.",
    features: [
      "Public mint with configurable price (0 = free)",
      "Optional maxSupply (0 = unlimited)",
      "No royalties",
      "setPrice / withdraw by owner",
    ],
    recommendedFor: "Open drops where the community mints their own agents.",
    code: OPEN,
  },
];

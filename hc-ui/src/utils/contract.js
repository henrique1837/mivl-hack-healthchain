import { ethers } from 'ethers';

// MIDL Regtest Configuration
const RPC_URL = 'https://rpc.staging.midl.xyz';
const CHAIN_ID = 24412; // Adjusted based on midlRegtest.id or usual MIDL staging

// Contract ABI (Simplified for HealthChain based on our implementation)
const HEALTH_CHAIN_ABI = [
    "function userEncryptionPubKeys(address) view returns (string)",
    "function registerEncryptionPubKey(string)",
    "function registerRecord(string, string) returns (uint256)",
    "function records(uint256) view returns (address, string, uint256, string, string)",
    "function createOffer(uint256, uint256, bytes32, uint256) returns (uint256)",
    "function payForOffer(uint256, string) payable",
    "function revealSecret(uint256, bytes32)",
    "function getAccessedRecordViaOffer(uint256) view returns (tuple(address owner, string ipfsCid, uint256 timestamp, string recordHash, string ownerEncryptionPubKey))",
    "event RecordRegistered(uint256 indexed recordId, address indexed owner, string ipfsCid, string ownerEncryptionPubKey)",
    "event OfferPaid(uint256 indexed offerId, address indexed requester, uint256 price)"
];

const CONTRACT_ADDRESS = '0xBF80Cc12C86a4bB5fe841B68C383C68bBB39c291'; // User needs to update this

export const getHealthChainContract = (signerOrProvider) => {
    return new ethers.Contract(CONTRACT_ADDRESS, HEALTH_CHAIN_ABI, signerOrProvider);
};

export const getProvider = () => {
    return new ethers.JsonRpcProvider(RPC_URL);
};

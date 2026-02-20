// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0; // Use 0.8.0 or match their example's 0.8.28

/**
 * @title HealthChain
 * @dev A consolidated smart contract for managing decentralized health IDs,
 *      encrypted health record pointers, and atomic data access swaps.
 *      Leverages standard asymmetric public keys for off-chain encryption.
 *      Payments are handled in the native cryptocurrency of the MIDL chain.
 */
contract HealthChain {
    // --- HealthID Functionality ---
    // Mapping from an EVM address to its associated asymmetric encryption Public Key (hex string).
    // This key will be used for off-chain data encryption/decryption by the user.
    mapping(address => string) public userEncryptionPubKeys;
    event EncryptionKeyRegistered(address indexed userAddress, string encryptionPubKey);
    event EncryptionKeyRemoved(address indexed userAddress);

    // --- HealthRecords Functionality ---
    struct HealthRecord {
        address owner;        // The address of the user who owns this record.
        string ipfsCid;       // IPFS Content Identifier of the encrypted record data.
        uint256 timestamp;    // Timestamp when the record was registered.
        string recordHash;    // A hash/checksum of the actual data for integrity check (optional)
        string ownerEncryptionPubKey; // Public key used by the owner to encrypt this record
    }
    mapping(uint256 => HealthRecord) public records;
    uint256 private nextRecordId;
    event RecordRegistered(uint256 indexed recordId, address indexed owner, string ipfsCid, string ownerEncryptionPubKey);

    // --- DataAccessSwap Functionality ---
    struct DataOffer {
        address owner;          // Address of the data owner
        uint256 recordId;       // ID of the record being offered
        uint256 price;          // Price in native cryptocurrency (e.g., in wei)
        bytes32 hashlock;       // Hashed secret (preimage known only to owner)
        address requester;      // Address of the requester who has paid (0x0 if not paid yet)
        uint256 expiration;     // Unix timestamp after which offer expires
        bool fulfilled;         // True if the owner has revealed the secret and received payment
        bool cancelled;         // True if the owner cancelled the offer before payment
    }
    mapping(uint256 => DataOffer) public offers;
    uint256 private nextOfferId;

    event OfferCreated(uint256 indexed offerId, address indexed owner, uint256 recordId, uint256 price, bytes32 hashlock, uint256 expiration);
    event OfferPaid(uint256 indexed offerId, address indexed requester, uint256 price);
    event OfferFulfilled(uint256 indexed offerId, address indexed owner, bytes32 secret);
    event RequesterRefunded(uint256 indexed offerId, address indexed requester);
    event OfferCancelled(uint256 indexed offerId, address indexed owner);

    uint256 public constant MIN_EXPIRATION_TIME = 1 hours;  // 1 hour
    uint256 public constant MAX_EXPIRATION_TIME = 24 hours; // 24 hours

    constructor() {
        nextRecordId = 1;
        nextOfferId = 1;
    }

    // Fallback function to receive native currency if sent without calling a specific function
    receive() external payable {}
    fallback() external payable {}

    // --- HealthID Functions (Generic Encryption Key) ---

    /**
     * @dev Registers or updates the asymmetric encryption Public Key for the calling address.
     *      This key will be used for off-chain data encryption/decryption by the user.
     *      @param _encryptionPubKey The asymmetric encryption Public Key in hexadecimal string format.
     */
    function registerEncryptionPubKey(string calldata _encryptionPubKey) public {
        require(bytes(_encryptionPubKey).length > 0, "Encryption Public Key cannot be empty");
        userEncryptionPubKeys[msg.sender] = _encryptionPubKey;
        emit EncryptionKeyRegistered(msg.sender, _encryptionPubKey);
    }

    /**
     * @dev Retrieves the asymmetric encryption Public Key for a given address.
     * @param _userAddress The EVM address of the user.
     * @return The encryption Public Key string associated with the address.
     */
    function getEncryptionPubKey(address _userAddress) public view returns (string memory) {
        return userEncryptionPubKeys[_userAddress];
    }

    /**
     * @dev Removes the asymmetric encryption Public Key registration for the calling address.
     *      Note: This does not affect data already encrypted with the key.
     *      Users should manage their data keys carefully off-chain.
     */
    function removeEncryptionPubKey() public {
        require(bytes(userEncryptionPubKeys[msg.sender]).length > 0, "No Encryption Public Key registered for this address");
        delete userEncryptionPubKeys[msg.sender];
        emit EncryptionKeyRemoved(msg.sender);
    }

    // --- HealthRecords Functions ---

    /**
     * @dev Registers a new encrypted health record.
     *      Requires the caller to have an encryption Public Key registered.
     * @param _ipfsCid The IPFS Content Identifier for the encrypted health data.
     * @param _recordHash A hash of the original (or encrypted) data for integrity verification.
     * @return The unique ID of the newly registered record.
     */
    function registerRecord(string calldata _ipfsCid, string calldata _recordHash) public returns (uint256) {
        require(bytes(_ipfsCid).length > 0, "IPFS CID cannot be empty");
        string memory ownerEncryptionPubKey = userEncryptionPubKeys[msg.sender];
        require(bytes(ownerEncryptionPubKey).length > 0, "Owner must register an Encryption Public Key first");

        uint256 recordId = nextRecordId++;
        records[recordId] = HealthRecord({
            owner: msg.sender,
            ipfsCid: _ipfsCid,
            timestamp: block.timestamp,
            recordHash: _recordHash,
            ownerEncryptionPubKey: ownerEncryptionPubKey
        });

        emit RecordRegistered(recordId, msg.sender, _ipfsCid, ownerEncryptionPubKey);
        return recordId;
    }

    /**
     * @dev Retrieves the details of a health record. Only the owner can call this.
     *      For others to get access, they must complete an atomic swap.
     * @param _recordId The ID of the record to retrieve.
     * @return The HealthRecord struct.
     */
    function getRecord(uint256 _recordId) public view returns (HealthRecord memory) {
        require(records[_recordId].owner != address(0), "Record does not exist");
        require(records[_recordId].owner == msg.sender, "Only the owner can directly retrieve record details");
        return records[_recordId];
    }

    // --- DataAccessSwap Functions ---

    /**
     * @dev Allows a data owner to create an offer to sell access to a specific record.
     * @param _recordId The ID of the health record.
     * @param _price The price in native cryptocurrency (e.g., in wei) for access.
     * @param _hashlock The keccak256 hash of a secret (known only to owner).
     * @param _expiration The timestamp when the offer expires. Must be in the future.
     * @return The unique ID of the created offer.
     */
    function createOffer(
        uint256 _recordId,
        uint256 _price,
        bytes32 _hashlock,
        uint256 _expiration
    ) public returns (uint256) {
        // Ensure the record exists and belongs to the caller
        require(records[_recordId].owner == msg.sender, "Caller is not the record owner");
        require(_price > 0, "Price must be greater than zero");
        require(_hashlock != bytes32(0), "Hashlock cannot be zero");
        require(_expiration > block.timestamp + MIN_EXPIRATION_TIME, "Expiration must be sufficiently in the future");
        require(_expiration <= block.timestamp + MAX_EXPIRATION_TIME, "Expiration too far in the future");

        uint256 offerId = nextOfferId++;
        offers[offerId] = DataOffer({
            owner: msg.sender,
            recordId: _recordId,
            price: _price,
            hashlock: _hashlock,
            requester: address(0),
            expiration: _expiration,
            fulfilled: false,
            cancelled: false
        });

        emit OfferCreated(offerId, msg.sender, _recordId, _price, _hashlock, _expiration);
        return offerId;
    }

    /**
     * @dev Allows a data owner to cancel an offer if no one has paid for it yet.
     * @param _offerId The ID of the offer to cancel.
     */
    function cancelOffer(uint256 _offerId) public {
        DataOffer storage offer = offers[_offerId];
        require(offer.owner == msg.sender, "Only the offer owner can cancel");
        require(offer.requester == address(0), "Cannot cancel after a requester has paid");
        require(!offer.fulfilled, "Offer already fulfilled");
        require(!offer.cancelled, "Offer already cancelled");

        offer.cancelled = true;
        emit OfferCancelled(_offerId, msg.sender);
    }

    /**
     * @dev Allows a requester to pay for an offer using native cryptocurrency.
     *      The `msg.value` sent with the transaction must match the `offer.price`.
     * @param _offerId The ID of the offer to pay for.
     * @param _requesterEncryptionPubKey The asymmetric encryption Public Key of the requester.
     */
    function payForOffer(uint256 _offerId, string calldata _requesterEncryptionPubKey) public payable {
        DataOffer storage offer = offers[_offerId];
        require(offer.owner != address(0), "Offer does not exist");
        require(offer.requester == address(0), "Offer has already been paid for");
        require(!offer.fulfilled, "Offer already fulfilled");
        require(!offer.cancelled, "Offer has been cancelled");
        require(block.timestamp < offer.expiration, "Offer has expired");
        require(bytes(_requesterEncryptionPubKey).length > 0, "Requester Encryption Public Key cannot be empty");
        require(msg.value == offer.price, "Incorrect payment amount sent");

        offer.requester = msg.sender;
        // The Dapp should now prompt the owner to re-encrypt and send the key off-chain
        // using the _requesterEncryptionPubKey provided here.

        emit OfferPaid(_offerId, msg.sender, offer.price);
    }

    /**
     * @dev Allows the data owner to reveal the pre-image of the hashlock, thereby claiming payment.
     *      This should only happen after the owner has sent the re-encrypted key off-chain to the requester.
     * @param _offerId The ID of the offer.
     * @param _secret The pre-image of the hashlock (the actual secret).
     */
    function revealSecret(uint256 _offerId, bytes32 _secret) public {
        DataOffer storage offer = offers[_offerId];
        require(offer.owner == msg.sender, "Only the offer owner can reveal the secret");
        require(offer.requester != address(0), "Offer has not been paid for yet");
        require(!offer.fulfilled, "Offer already fulfilled");
        require(!offer.cancelled, "Offer has been cancelled");
        require(block.timestamp < offer.expiration, "Offer has expired, cannot fulfill");
        require(offer.hashlock == keccak256(abi.encodePacked(_secret)), "Invalid secret");

        // Transfer payment from this contract to the owner
        (bool success, ) = offer.owner.call{value: offer.price}("");
        require(success, "Failed to transfer native currency to owner");

        offer.fulfilled = true;
        emit OfferFulfilled(_offerId, msg.sender, _secret);
    }

    /**
     * @dev Allows the requester to reclaim their payment if the offer has expired
     *      and the owner has not revealed the secret.
     * @param _offerId The ID of the offer.
     */
    function reclaimPayment(uint256 _offerId) public {
        DataOffer storage offer = offers[_offerId];
        require(offer.requester == msg.sender, "Only the requester can reclaim payment");
        require(offer.requester != address(0), "Offer has not been paid for");
        require(!offer.fulfilled, "Offer has already been fulfilled");
        require(block.timestamp >= offer.expiration, "Offer has not expired yet");
        require(!offer.cancelled, "Offer was cancelled by owner");

        // Transfer payment back to the requester
        (bool success, ) = offer.requester.call{value: offer.price}("");
        require(success, "Failed to refund native currency to requester");

        // Mark as fulfilled to prevent double-refunds (even though it's a refund path)
        offer.fulfilled = true;
        emit RequesterRefunded(_offerId, msg.sender);
    }

    /**
     * @dev Allows any address that has successfully completed an atomic swap
     *      (i.e., `revealSecret` was called for their payment) to retrieve the record details.
     *      This is the access point for purchasers.
     * @param _offerId The ID of the offer that granted access.
     * @return The HealthRecord struct.
     */
    function getAccessedRecordViaOffer(uint256 _offerId) public view returns (HealthRecord memory) {
        DataOffer memory offer = offers[_offerId];
        require(offer.owner != address(0), "Offer does not exist");
        require(offer.requester == msg.sender, "Caller is not the requester for this offer");
        require(offer.fulfilled, "Offer has not been fulfilled yet");
        return records[offer.recordId];
    }
}
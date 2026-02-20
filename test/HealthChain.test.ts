import { expect } from "chai";
import { ethers } from "hardhat";
import { HealthChain } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("HealthChain", function () {
    let healthChain: HealthChain;
    let owner: HardhatEthersSigner;
    let requester: HardhatEthersSigner;
    let otherAccount: HardhatEthersSigner;

    const PUB_KEY_1 = "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
    const PUB_KEY_2 = "04c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5918e9c704a2be25cf42c4b8e05c86c123d4c38d4f4007887d157303f901a1c93";
    const IPFS_CID = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
    const RECORD_HASH = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

    beforeEach(async function () {
        [owner, requester, otherAccount] = await ethers.getSigners();
        const HealthChainFactory = await ethers.getContractFactory("HealthChain");
        healthChain = await HealthChainFactory.deploy();
    });

    describe("HealthID (Encryption Keys)", function () {
        it("Should register an encryption public key", async function () {
            await healthChain.connect(owner).registerEncryptionPubKey(PUB_KEY_1);
            expect(await healthChain.getEncryptionPubKey(owner.address)).to.equal(PUB_KEY_1);
        });

        it("Should emit EncryptionKeyRegistered event", async function () {
            await expect(healthChain.connect(owner).registerEncryptionPubKey(PUB_KEY_1))
                .to.emit(healthChain, "EncryptionKeyRegistered")
                .withArgs(owner.address, PUB_KEY_1);
        });

        it("Should remove an encryption public key", async function () {
            await healthChain.connect(owner).registerEncryptionPubKey(PUB_KEY_1);
            await healthChain.connect(owner).removeEncryptionPubKey();
            expect(await healthChain.getEncryptionPubKey(owner.address)).to.equal("");
        });

        it("Should fail if removing key when none registered", async function () {
            await expect(healthChain.connect(owner).removeEncryptionPubKey())
                .to.be.revertedWith("No Encryption Public Key registered for this address");
        });
    });

    describe("HealthRecords", function () {
        beforeEach(async function () {
            await healthChain.connect(owner).registerEncryptionPubKey(PUB_KEY_1);
        });

        it("Should register a health record", async function () {
            await expect(healthChain.connect(owner).registerRecord(IPFS_CID, RECORD_HASH))
                .to.emit(healthChain, "RecordRegistered");

            const record = await healthChain.connect(owner).getRecord(1);
            expect(record.owner).to.equal(owner.address);
            expect(record.ipfsCid).to.equal(IPFS_CID);
            expect(record.ownerEncryptionPubKey).to.equal(PUB_KEY_1);
        });

        it("Should fail if owner has no public key registered", async function () {
            await healthChain.connect(otherAccount).registerRecord(IPFS_CID, RECORD_HASH).catch(() => { }); // Ensure next call fails
            await expect(healthChain.connect(otherAccount).registerRecord(IPFS_CID, RECORD_HASH))
                .to.be.revertedWith("Owner must register an Encryption Public Key first");
        });

        it("Should only allow the owner to retrieve record details directly", async function () {
            await healthChain.connect(owner).registerRecord(IPFS_CID, RECORD_HASH);
            await expect(healthChain.connect(otherAccount).getRecord(1))
                .to.be.revertedWith("Only the owner can directly retrieve record details");
        });
    });

    describe("DataAccessSwap", function () {
        const PRICE = ethers.parseEther("1");
        const SECRET = ethers.encodeBytes32String("secret");
        const HASHLOCK = ethers.keccak256(SECRET);
        let recordId: number;
        let expiration: number;

        beforeEach(async function () {
            await healthChain.connect(owner).registerEncryptionPubKey(PUB_KEY_1);
            await healthChain.connect(owner).registerRecord(IPFS_CID, RECORD_HASH);
            recordId = 1;
            const latestBlock = await ethers.provider.getBlock("latest");
            expiration = latestBlock!.timestamp + 3600 + 10; // 1 hour + 10s
        });

        it("Should create a data offer", async function () {
            await expect(healthChain.connect(owner).createOffer(recordId, PRICE, HASHLOCK, expiration))
                .to.emit(healthChain, "OfferCreated")
                .withArgs(1, owner.address, recordId, PRICE, HASHLOCK, expiration);
        });

        it("Should fail if non-owner tries to create offer", async function () {
            await expect(healthChain.connect(otherAccount).createOffer(recordId, PRICE, HASHLOCK, expiration))
                .to.be.revertedWith("Caller is not the record owner");
        });

        it("Should allow a requester to pay for an offer", async function () {
            await healthChain.connect(owner).createOffer(recordId, PRICE, HASHLOCK, expiration);
            await expect(healthChain.connect(requester).payForOffer(1, PUB_KEY_2, { value: PRICE }))
                .to.emit(healthChain, "OfferPaid")
                .withArgs(1, requester.address, PRICE);

            const offer = await healthChain.offers(1);
            expect(offer.requester).to.equal(requester.address);
        });

        it("Should allow the owner to reveal secret and claim payment", async function () {
            await healthChain.connect(owner).createOffer(recordId, PRICE, HASHLOCK, expiration);
            await healthChain.connect(requester).payForOffer(1, PUB_KEY_2, { value: PRICE });

            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await expect(healthChain.connect(owner).revealSecret(1, SECRET))
                .to.emit(healthChain, "OfferFulfilled")
                .withArgs(1, owner.address, SECRET);

            const balanceAfter = await ethers.provider.getBalance(owner.address);
            // We don't check exact balance because of gas costs, but it should be higher
            expect(balanceAfter).to.be.gt(balanceBefore);

            const offer = await healthChain.offers(1);
            expect(offer.fulfilled).to.be.true;
        });

        it("Should allow requester to reclaim payment after expiration", async function () {
            await healthChain.connect(owner).createOffer(recordId, PRICE, HASHLOCK, expiration);
            await healthChain.connect(requester).payForOffer(1, PUB_KEY_2, { value: PRICE });

            // Fast forward time past expiration (3610s)
            await ethers.provider.send("evm_increaseTime", [4000]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await ethers.provider.getBalance(requester.address);
            await expect(healthChain.connect(requester).reclaimPayment(1))
                .to.emit(healthChain, "RequesterRefunded")
                .withArgs(1, requester.address);

            const balanceAfter = await ethers.provider.getBalance(requester.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should allow requester to access record after fulfillment", async function () {
            await healthChain.connect(owner).createOffer(recordId, PRICE, HASHLOCK, expiration);
            await healthChain.connect(requester).payForOffer(1, PUB_KEY_2, { value: PRICE });
            await healthChain.connect(owner).revealSecret(1, SECRET);

            const record = await healthChain.connect(requester).getAccessedRecordViaOffer(1);
            expect(record.ipfsCid).to.equal(IPFS_CID);
        });
    });
});

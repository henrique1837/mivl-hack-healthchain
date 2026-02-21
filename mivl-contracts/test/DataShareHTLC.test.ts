import { expect } from "chai";
import { ethers } from "hardhat";
import { DataShareHTLC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DataShareHTLC", function () {
    let htlc: DataShareHTLC;
    let requester: HardhatEthersSigner;
    let provider: HardhatEthersSigner;
    let other: HardhatEthersSigner;

    // A secret preimage and its SHA-256 hashlock
    const PREIMAGE = ethers.encodeBytes32String("my-secret-preimage");
    // SHA-256 of the preimage — must match what the Solidity contract uses
    const HASHLOCK = ethers.sha256(PREIMAGE);

    const ONE_ETH = ethers.parseEther("1");
    const TIMELOCK_DURATION = 3600n; // 1 hour in seconds

    beforeEach(async function () {
        [requester, provider, other] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("DataShareHTLC");
        htlc = await Factory.deploy();
    });

    // ─── lock ────────────────────────────────────────────────────────────────

    describe("lock()", function () {
        it("should create a lock and emit Locked event", async function () {
            const tx = await htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, {
                value: ONE_ETH,
            });
            const receipt = await tx.wait();

            // Parse lockId from the Locked event
            const event = receipt?.logs
                .map(log => { try { return htlc.interface.parseLog(log); } catch { return null; } })
                .find(e => e?.name === "Locked");
            expect(event).to.not.be.undefined;

            const lockId = event!.args.lockId as string;
            const lock = await htlc.getLock(lockId);

            expect(lock.requester).to.equal(requester.address);
            expect(lock.provider).to.equal(provider.address);
            expect(lock.amount).to.equal(ONE_ETH);
            expect(lock.hashlock).to.equal(HASHLOCK);
            expect(lock.claimed).to.be.false;
            expect(lock.refunded).to.be.false;
        });

        it("should revert if no value is sent", async function () {
            await expect(
                htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, { value: 0 })
            ).to.be.revertedWith("Must lock some value");
        });

        it("should revert if provider is zero address", async function () {
            await expect(
                htlc.connect(requester).lock(ethers.ZeroAddress, HASHLOCK, TIMELOCK_DURATION, { value: ONE_ETH })
            ).to.be.revertedWith("Invalid provider");
        });

        it("should revert if timelockDuration is zero", async function () {
            await expect(
                htlc.connect(requester).lock(provider.address, HASHLOCK, 0, { value: ONE_ETH })
            ).to.be.revertedWith("Invalid timelock");
        });

        it("should produce unique lockIds for identical params (nonce)", async function () {
            const tx1 = await htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, { value: ONE_ETH });
            const tx2 = await htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, { value: ONE_ETH });
            const r1 = await tx1.wait();
            const r2 = await tx2.wait();
            const getId = (receipt: any) =>
                receipt?.logs
                    .map((log: any) => { try { return htlc.interface.parseLog(log); } catch { return null; } })
                    .find((e: any) => e?.name === "Locked")?.args.lockId;
            expect(getId(r1)).to.not.equal(getId(r2));
        });
    });

    // ─── claim ───────────────────────────────────────────────────────────────

    describe("claim()", function () {
        let lockId: string;

        beforeEach(async function () {
            const tx = await htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, { value: ONE_ETH });
            const receipt = await tx.wait();
            lockId = receipt?.logs
                .map(log => { try { return htlc.interface.parseLog(log); } catch { return null; } })
                .find(e => e?.name === "Locked")!.args.lockId;
        });

        it("should allow provider to claim with correct preimage", async function () {
            const balanceBefore = await ethers.provider.getBalance(provider.address);
            await expect(htlc.connect(provider).claim(lockId, PREIMAGE))
                .to.emit(htlc, "Claimed")
                .withArgs(lockId, PREIMAGE);

            const balanceAfter = await ethers.provider.getBalance(provider.address);
            expect(balanceAfter).to.be.gt(balanceBefore); // received funds minus gas

            const lock = await htlc.getLock(lockId);
            expect(lock.claimed).to.be.true;
        });

        it("should revert if called by non-provider", async function () {
            await expect(htlc.connect(other).claim(lockId, PREIMAGE))
                .to.be.revertedWith("Only provider can claim");
        });

        it("should revert with wrong preimage", async function () {
            const wrongPreimage = ethers.encodeBytes32String("wrong");
            await expect(htlc.connect(provider).claim(lockId, wrongPreimage))
                .to.be.revertedWith("Wrong preimage");
        });

        it("should revert after timelock expires", async function () {
            await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DURATION) + 1]);
            await ethers.provider.send("evm_mine", []);
            await expect(htlc.connect(provider).claim(lockId, PREIMAGE))
                .to.be.revertedWith("Lock expired");
        });

        it("should revert on double-claim", async function () {
            await htlc.connect(provider).claim(lockId, PREIMAGE);
            await expect(htlc.connect(provider).claim(lockId, PREIMAGE))
                .to.be.revertedWith("Already settled");
        });
    });

    // ─── refund ──────────────────────────────────────────────────────────────

    describe("refund()", function () {
        let lockId: string;

        beforeEach(async function () {
            const tx = await htlc.connect(requester).lock(provider.address, HASHLOCK, TIMELOCK_DURATION, { value: ONE_ETH });
            const receipt = await tx.wait();
            lockId = receipt?.logs
                .map(log => { try { return htlc.interface.parseLog(log); } catch { return null; } })
                .find(e => e?.name === "Locked")!.args.lockId;
        });

        it("should allow requester to refund after timelock expiry", async function () {
            await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DURATION) + 1]);
            await ethers.provider.send("evm_mine", []);

            const balanceBefore = await ethers.provider.getBalance(requester.address);
            await expect(htlc.connect(requester).refund(lockId))
                .to.emit(htlc, "Refunded")
                .withArgs(lockId);

            const balanceAfter = await ethers.provider.getBalance(requester.address);
            expect(balanceAfter).to.be.gt(balanceBefore);

            const lock = await htlc.getLock(lockId);
            expect(lock.refunded).to.be.true;
        });

        it("should revert if timelock has not expired yet", async function () {
            await expect(htlc.connect(requester).refund(lockId))
                .to.be.revertedWith("Not yet expired");
        });

        it("should revert if called by non-requester", async function () {
            await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DURATION) + 1]);
            await ethers.provider.send("evm_mine", []);
            await expect(htlc.connect(other).refund(lockId))
                .to.be.revertedWith("Only requester can refund");
        });

        it("should revert on double-refund", async function () {
            await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DURATION) + 1]);
            await ethers.provider.send("evm_mine", []);
            await htlc.connect(requester).refund(lockId);
            await expect(htlc.connect(requester).refund(lockId))
                .to.be.revertedWith("Already settled");
        });

        it("should revert if provider already claimed", async function () {
            await htlc.connect(provider).claim(lockId, PREIMAGE);
            await ethers.provider.send("evm_increaseTime", [Number(TIMELOCK_DURATION) + 1]);
            await ethers.provider.send("evm_mine", []);
            await expect(htlc.connect(requester).refund(lockId))
                .to.be.revertedWith("Already settled");
        });
    });

    // ─── getLock ─────────────────────────────────────────────────────────────

    describe("getLock()", function () {
        it("should return a zeroed struct for a non-existent lockId", async function () {
            const fakeLockId = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));
            const lock = await htlc.getLock(fakeLockId);
            expect(lock.requester).to.equal(ethers.ZeroAddress);
            expect(lock.amount).to.equal(0n);
        });
    });
});

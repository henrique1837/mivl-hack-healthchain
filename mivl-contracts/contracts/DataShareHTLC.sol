// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DataShareHTLC {
    struct Lock {
        address requester;
        address provider;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool claimed;
        bool refunded;
    }

    mapping(bytes32 => Lock) public locks;
    uint256 private nonce;

    event Locked(bytes32 indexed lockId, address indexed requester, address indexed provider, bytes32 hashlock, uint256 timelock, uint256 amount);
    event Claimed(bytes32 indexed lockId, bytes32 preimage);
    event Refunded(bytes32 indexed lockId);

    function lock(address provider, bytes32 hashlock, uint256 timelockDuration)
        external payable returns (bytes32 lockId)
    {
        require(msg.value > 0, "Must lock some value");
        require(provider != address(0), "Invalid provider");
        require(timelockDuration > 0, "Invalid timelock");

        lockId = keccak256(abi.encodePacked(msg.sender, provider, hashlock, nonce++));
        require(locks[lockId].requester == address(0), "Lock exists");

        locks[lockId] = Lock({
            requester: msg.sender,
            provider: provider,
            amount: msg.value,
            hashlock: hashlock,
            timelock: block.timestamp + timelockDuration,
            claimed: false,
            refunded: false
        });

        emit Locked(lockId, msg.sender, provider, hashlock, block.timestamp + timelockDuration, msg.value);
    }

    function claim(bytes32 lockId, bytes32 preimage) external {
        Lock storage l = locks[lockId];
        require(l.provider == msg.sender, "Only provider can claim");
        require(!l.claimed && !l.refunded, "Already settled");
        require(block.timestamp < l.timelock, "Lock expired");
        require(sha256(abi.encodePacked(preimage)) == l.hashlock, "Wrong preimage");

        l.claimed = true;
        payable(l.provider).transfer(l.amount);
        emit Claimed(lockId, preimage);
    }

    function refund(bytes32 lockId) external {
        Lock storage l = locks[lockId];
        require(l.requester == msg.sender, "Only requester can refund");
        require(!l.claimed && !l.refunded, "Already settled");
        require(block.timestamp >= l.timelock, "Not yet expired");

        l.refunded = true;
        payable(l.requester).transfer(l.amount);
        emit Refunded(lockId);
    }

    function getLock(bytes32 lockId) external view returns (Lock memory) {
        return locks[lockId];
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AskReceipts
/// @notice A public, append-only count of questions answered and paid for.
///
/// x402 settlements move funds inside the token contract, so from the outside
/// they are indistinguishable from any other transfer: there is no on-chain
/// record of *what was bought*. This contract is that record, and it is what
/// makes the service's usage auditable by anyone rather than by us.
///
/// It deliberately holds no funds and takes no custody. Payment already
/// happened over x402 before anything here is called; this only attests to it.
contract AskReceipts {
    struct Stats {
        uint128 answered; // questions this address has paid for
        uint128 spentMicros; // total paid, in USDC micros (6 dp)
    }

    /// @notice Per-user totals.
    mapping(address => Stats) public stats;

    /// @notice Service-wide totals.
    uint128 public totalAnswered;
    uint128 public totalSpentMicros;

    /// @notice The address allowed to record receipts (the service backend).
    address public recorder;

    /// @notice Emitted once per paid answer.
    /// @param user     Who paid, i.e. the session key that signed the payment.
    /// @param micros   Amount paid in USDC micros.
    /// @param settlement The x402 settlement transaction hash.
    event Answered(address indexed user, uint128 micros, bytes32 indexed settlement);

    event RecorderTransferred(address indexed from, address indexed to);

    error NotRecorder();
    error ZeroAddress();
    error AlreadyRecorded();

    /// @notice Settlement hashes already recorded, so a receipt cannot be
    /// counted twice even if the backend retries.
    mapping(bytes32 => bool) public recorded;

    constructor(address recorder_) {
        if (recorder_ == address(0)) revert ZeroAddress();
        recorder = recorder_;
        emit RecorderTransferred(address(0), recorder_);
    }

    modifier onlyRecorder() {
        if (msg.sender != recorder) revert NotRecorder();
        _;
    }

    /// @notice Record one paid answer.
    /// @dev Reverts on a duplicate settlement hash: retries are safe, but
    /// double-counting would quietly inflate a public number.
    function record(address user, uint128 micros, bytes32 settlement) external onlyRecorder {
        if (user == address(0)) revert ZeroAddress();
        if (recorded[settlement]) revert AlreadyRecorded();
        recorded[settlement] = true;

        Stats storage s = stats[user];
        unchecked {
            // A counter of answers and a sum of cent-scale payments cannot
            // approach 2^128 in any real usage.
            s.answered += 1;
            s.spentMicros += micros;
            totalAnswered += 1;
            totalSpentMicros += micros;
        }

        emit Answered(user, micros, settlement);
    }

    /// @notice Hand the recorder role to a new backend key.
    function transferRecorder(address to) external onlyRecorder {
        if (to == address(0)) revert ZeroAddress();
        emit RecorderTransferred(recorder, to);
        recorder = to;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AskReceipts} from "../AskReceipts.sol";

contract AskReceiptsTest is Test {
    AskReceipts receipts;
    address recorder = address(0xBEEF);
    address user = address(0xCAFE);

    function setUp() public {
        receipts = new AskReceipts(recorder);
    }

    function test_recordsAnAnswer() public {
        vm.prank(recorder);
        receipts.record(user, 10_000, keccak256("tx1"));

        (uint128 answered, uint128 spent) = receipts.stats(user);
        assertEq(answered, 1);
        assertEq(spent, 10_000);
        assertEq(receipts.totalAnswered(), 1);
        assertEq(receipts.totalSpentMicros(), 10_000);
    }

    /// The whole point of a public counter is that it cannot be inflated.
    function test_rejectsDuplicateSettlement() public {
        vm.startPrank(recorder);
        receipts.record(user, 10_000, keccak256("tx1"));
        vm.expectRevert(AskReceipts.AlreadyRecorded.selector);
        receipts.record(user, 10_000, keccak256("tx1"));
        vm.stopPrank();

        assertEq(receipts.totalAnswered(), 1, "a retry must not double count");
    }

    function test_onlyRecorderCanRecord() public {
        vm.prank(address(0xD00D));
        vm.expectRevert(AskReceipts.NotRecorder.selector);
        receipts.record(user, 10_000, keccak256("tx1"));
    }

    function test_rejectsZeroUser() public {
        vm.prank(recorder);
        vm.expectRevert(AskReceipts.ZeroAddress.selector);
        receipts.record(address(0), 10_000, keccak256("tx1"));
    }

    function test_transfersRecorder() public {
        address next = address(0xF00D);
        vm.prank(recorder);
        receipts.transferRecorder(next);
        assertEq(receipts.recorder(), next);

        vm.prank(recorder);
        vm.expectRevert(AskReceipts.NotRecorder.selector);
        receipts.record(user, 1, keccak256("tx2"));

        vm.prank(next);
        receipts.record(user, 1, keccak256("tx2"));
        assertEq(receipts.totalAnswered(), 1);
    }

    function test_cannotStrandRecorderRole() public {
        vm.prank(recorder);
        vm.expectRevert(AskReceipts.ZeroAddress.selector);
        receipts.transferRecorder(address(0));
    }

    /// Totals must equal the sum of every receipt, for any sequence of them.
    function testFuzz_totalsTrackIndividualRecords(uint96[8] calldata amounts) public {
        uint256 expectedSpend;
        vm.startPrank(recorder);
        for (uint256 i; i < amounts.length; i++) {
            receipts.record(user, amounts[i], keccak256(abi.encode(i)));
            expectedSpend += amounts[i];
        }
        vm.stopPrank();

        (uint128 answered, uint128 spent) = receipts.stats(user);
        assertEq(answered, amounts.length);
        assertEq(spent, expectedSpend);
        assertEq(receipts.totalSpentMicros(), expectedSpend);
    }
}

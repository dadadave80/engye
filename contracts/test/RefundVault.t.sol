// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IRefundVault} from "../interfaces/IRefundVault.sol";
import {MockUSDC} from "./BondedEscrow.t.sol";

contract RefundVaultTest is Test {
    IRefundVault vault;
    MockUSDC usdc;
    address treasury = makeAddr("treasury");
    address requester = makeAddr("requester");
    address resolver = makeAddr("resolver");
    bytes32 constant MATCH = keccak256("match-1");

    function setUp() public {
        usdc = new MockUSDC();
        vault = IRefundVault(deployCode("RefundVault", abi.encode(address(usdc), resolver)));
        usdc.mint(treasury, 100e6);
        vm.startPrank(treasury);
        usdc.approve(address(vault), type(uint256).max);
        vault.fund(100e6);
        vm.stopPrank();
    }

    function test_refund_once() public {
        vm.prank(resolver);
        vault.refund(MATCH, requester, 5e6);
        assertEq(usdc.balanceOf(requester), 5e6);
        assertEq(vault.refunded(MATCH), 5e6);
    }

    function test_revert_double_refund() public {
        vm.startPrank(resolver);
        vault.refund(MATCH, requester, 5e6);
        vm.expectRevert(bytes("already refunded"));
        vault.refund(MATCH, requester, 5e6); // crashed-process retry can't double-pay
        vm.stopPrank();
    }

    function test_revert_non_resolver() public {
        vm.expectRevert(bytes("not resolver"));
        vault.refund(MATCH, requester, 5e6);
        vm.expectRevert(bytes("not resolver"));
        vault.sweep(requester, 1e6);
    }

    function test_sweep() public {
        vm.prank(resolver);
        vault.sweep(treasury, 100e6);
        assertEq(usdc.balanceOf(treasury), 100e6);
    }
}

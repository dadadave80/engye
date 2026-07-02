// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IProviderStake} from "../interfaces/IProviderStake.sol";
import {MockUSDC} from "./BondedEscrow.t.sol";

contract ProviderStakeTest is Test {
    IProviderStake staking;
    MockUSDC usdc;
    address provider = makeAddr("provider");
    address requester = makeAddr("requester");
    address resolver = makeAddr("resolver");
    bytes32 constant MATCH = keccak256("match-1");
    uint256 constant COOLDOWN = 3600;

    function setUp() public {
        usdc = new MockUSDC();
        staking = IProviderStake(deployCode("ProviderStake", abi.encode(address(usdc), resolver)));
        usdc.mint(provider, 100e6);
        vm.startPrank(provider);
        usdc.approve(address(staking), type(uint256).max);
        staking.stake(10e6);
        vm.stopPrank();
    }

    function test_stake_recorded() public view {
        assertEq(staking.stakes(provider), 10e6);
        assertEq(usdc.balanceOf(address(staking)), 10e6);
    }

    function test_slash_pays_requester_capped_at_stake() public {
        vm.prank(resolver);
        uint256 slashed = staking.slash_stake(MATCH, provider, requester, 25e6); // asks more than staked
        assertEq(slashed, 10e6);
        assertEq(usdc.balanceOf(requester), 10e6);
        assertEq(staking.stakes(provider), 0);
    }

    function test_slash_once_per_match() public {
        vm.startPrank(resolver);
        staking.slash_stake(MATCH, provider, requester, 1e6);
        vm.expectRevert(bytes("already slashed"));
        staking.slash_stake(MATCH, provider, requester, 1e6);
        vm.stopPrank();
    }

    function test_slash_zero_stake_returns_zero() public {
        address unstaked = makeAddr("unstaked");
        vm.prank(resolver);
        uint256 slashed = staking.slash_stake(MATCH, unstaked, requester, 1e6);
        assertEq(slashed, 0);
        assertEq(staking.slashed_for(MATCH), 0); // no phantom record — match stays slashable
    }

    function test_revert_non_resolver_slash() public {
        vm.expectRevert(bytes("not resolver"));
        staking.slash_stake(MATCH, provider, requester, 1e6);
    }

    function test_unstake_cooldown_enforced() public {
        vm.startPrank(provider);
        staking.request_unstake(10e6);
        vm.expectRevert(bytes("cooldown"));
        staking.withdraw();
        vm.warp(block.timestamp + COOLDOWN);
        staking.withdraw();
        vm.stopPrank();
        assertEq(usdc.balanceOf(provider), 100e6);
        assertEq(staking.stakes(provider), 0);
    }

    function test_exit_stays_slashable_during_cooldown() public {
        vm.prank(provider);
        staking.request_unstake(10e6); // provider tries to run
        vm.prank(resolver);
        staking.slash_stake(MATCH, provider, requester, 6e6); // slash lands anyway
        assertEq(usdc.balanceOf(requester), 6e6);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(provider);
        staking.withdraw(); // only the un-slashed remainder exits
        assertEq(staking.stakes(provider), 0);
        assertEq(usdc.balanceOf(provider), 94e6);
    }

    function test_revert_withdraw_fully_slashed() public {
        vm.prank(provider);
        staking.request_unstake(10e6);
        vm.prank(resolver);
        staking.slash_stake(MATCH, provider, requester, 10e6);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(provider);
        vm.expectRevert(bytes("fully slashed"));
        staking.withdraw();
    }

    function testFuzz_slash_never_exceeds_stake(uint96 stakeAmt, uint96 slashAmt) public {
        vm.assume(stakeAmt > 0);
        address p2 = makeAddr("p2");
        usdc.mint(p2, stakeAmt);
        vm.startPrank(p2);
        usdc.approve(address(staking), type(uint256).max);
        staking.stake(stakeAmt);
        vm.stopPrank();
        vm.prank(resolver);
        uint256 slashed = staking.slash_stake(keccak256("m2"), p2, requester, slashAmt);
        assertLe(slashed, stakeAmt);
        assertEq(staking.stakes(p2), uint256(stakeAmt) - slashed);
    }
}

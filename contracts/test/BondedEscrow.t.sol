// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IBondedEscrow} from "../interfaces/IBondedEscrow.sol";

contract MockUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BondedEscrowTest is Test {
    IBondedEscrow escrow;
    MockUSDC usdc;
    address broker = makeAddr("broker");
    address requester = makeAddr("requester");
    address resolver = makeAddr("resolver");
    address keeper = makeAddr("keeper");
    bytes32 constant MATCH = keccak256("match-1");
    bytes32 constant DECISION = keccak256('{"action":"accept","confidence":0.9}');
    uint256 constant TTL = 10 minutes;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = IBondedEscrow(deployCode("BondedEscrow", abi.encode(address(usdc), resolver)));
        usdc.mint(broker, 1_000_000e6);
        vm.prank(broker);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _post(bytes32 id, uint256 amount) internal {
        vm.prank(broker);
        escrow.create_bond(id, amount, requester, DECISION, block.timestamp + TTL);
    }

    function test_create_bond() public {
        _post(MATCH, 1000);
        (address poster, address req, uint256 amount, uint8 status, bytes32 dh, uint256 deadline) =
            escrow.bonds(MATCH);
        assertEq(poster, broker);
        assertEq(req, requester);
        assertEq(amount, 1000);
        assertEq(status, 1); // OPEN
        assertEq(dh, DECISION);
        assertEq(deadline, block.timestamp + TTL);
        assertEq(usdc.balanceOf(address(escrow)), 1000);
    }

    function test_release_returns_to_poster() public {
        _post(MATCH, 1000);
        uint256 before = usdc.balanceOf(broker);
        vm.prank(resolver);
        escrow.release(MATCH);
        assertEq(usdc.balanceOf(broker), before + 1000);
        (,,, uint8 status,,) = escrow.bonds(MATCH);
        assertEq(status, 2); // RELEASED
    }

    function test_slash_pays_requester() public {
        _post(MATCH, 1000);
        vm.prank(resolver);
        escrow.slash(MATCH);
        assertEq(usdc.balanceOf(requester), 1000);
        (,,, uint8 status,,) = escrow.bonds(MATCH);
        assertEq(status, 3); // SLASHED
    }

    function test_timeout_claim_by_anyone_pays_requester() public {
        _post(MATCH, 1000);
        vm.warp(block.timestamp + TTL);
        vm.prank(keeper);
        escrow.claim_timeout(MATCH);
        assertEq(usdc.balanceOf(requester), 1000);
        assertEq(usdc.balanceOf(keeper), 0); // keeper rescues, requester is paid
        (,,, uint8 status,,) = escrow.bonds(MATCH);
        assertEq(status, 4); // TIMEOUT_CLAIMED
    }

    function test_revert_timeout_before_deadline() public {
        _post(MATCH, 1000);
        vm.warp(block.timestamp + TTL - 1);
        vm.expectRevert(bytes("not expired"));
        escrow.claim_timeout(MATCH);
    }

    function test_resolver_settle_beats_timeout_race() public {
        _post(MATCH, 1000);
        vm.warp(block.timestamp + TTL); // expired, but resolver settles first
        vm.prank(resolver);
        escrow.release(MATCH);
        vm.expectRevert(bytes("not open"));
        escrow.claim_timeout(MATCH);
    }

    function test_revert_double_settle() public {
        _post(MATCH, 1000);
        vm.startPrank(resolver);
        escrow.release(MATCH);
        vm.expectRevert(bytes("not open"));
        escrow.slash(MATCH);
        vm.expectRevert(bytes("not open"));
        escrow.release(MATCH);
        vm.stopPrank();
    }

    function test_revert_non_resolver() public {
        _post(MATCH, 1000);
        vm.prank(broker);
        vm.expectRevert(bytes("not resolver"));
        escrow.release(MATCH);
        vm.prank(requester);
        vm.expectRevert(bytes("not resolver"));
        escrow.slash(MATCH);
    }

    function test_revert_duplicate_bond() public {
        _post(MATCH, 1000);
        vm.prank(broker);
        vm.expectRevert(bytes("bond exists"));
        escrow.create_bond(MATCH, 500, requester, DECISION, block.timestamp + TTL);
    }

    function test_revert_zero_amount() public {
        vm.prank(broker);
        vm.expectRevert(bytes("zero amount"));
        escrow.create_bond(MATCH, 0, requester, DECISION, block.timestamp + TTL);
    }

    function test_revert_empty_decision_hash() public {
        vm.prank(broker);
        vm.expectRevert(bytes("no decision"));
        escrow.create_bond(MATCH, 1000, requester, bytes32(0), block.timestamp + TTL);
    }

    function test_revert_past_deadline() public {
        vm.prank(broker);
        vm.expectRevert(bytes("past deadline"));
        escrow.create_bond(MATCH, 1000, requester, DECISION, block.timestamp);
    }

    function testFuzz_lifecycle(uint96 amount, bytes32 id, uint8 path) public {
        vm.assume(amount > 0);
        usdc.mint(broker, amount);
        _post(id, amount);
        uint256 before = usdc.balanceOf(broker);
        if (path % 3 == 0) {
            vm.prank(resolver);
            escrow.release(id);
            assertEq(usdc.balanceOf(broker), before + amount);
        } else if (path % 3 == 1) {
            vm.prank(resolver);
            escrow.slash(id);
            assertEq(usdc.balanceOf(requester), amount);
        } else {
            vm.warp(block.timestamp + TTL);
            escrow.claim_timeout(id);
            assertEq(usdc.balanceOf(requester), amount);
        }
    }
}

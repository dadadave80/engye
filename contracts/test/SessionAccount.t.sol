// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ISessionAccount} from "../interfaces/ISessionAccount.sol";
import {MockUSDC} from "./BondedEscrow.t.sol";

/// Exercises the delegate through a REAL EIP-7702 delegation (vm.signAndAttachDelegation),
/// so code runs in the EOA's storage context exactly as on Arc.
contract SessionAccountTest is Test {
    address delegate;
    MockUSDC usdc;

    uint256 rootPk;
    address root; // the funded human EOA, 7702-delegated
    uint256 rolePk;
    address role; // a role EOA (broker/provider/...), also delegated
    address session = makeAddr("session"); // the agent's session key
    address intruder = makeAddr("intruder");

    function setUp() public {
        delegate = deployCode("SessionAccount");
        usdc = new MockUSDC();
        (root, rootPk) = makeAddrAndKey("root");
        (role, rolePk) = makeAddrAndKey("role");
        vm.signAndAttachDelegation(delegate, rootPk);
        vm.signAndAttachDelegation(delegate, rolePk);
        usdc.mint(root, 100e6);
    }

    function test_root_key_is_self_admin() public {
        vm.prank(root); // root key sending to itself: msg.sender == self
        ISessionAccount(root).add_signer(session);
        assertTrue(ISessionAccount(root).signers(session));
    }

    function test_session_signer_executes_transfer() public {
        vm.prank(root);
        ISessionAccount(root).add_signer(session);
        vm.prank(session);
        ISessionAccount(root).execute(
            address(usdc), 0, abi.encodeCall(MockUSDC.transfer, (session, 5e6))
        );
        assertEq(usdc.balanceOf(session), 5e6);
        assertEq(usdc.balanceOf(root), 95e6);
    }

    function test_revert_unauthorized_execute() public {
        vm.prank(intruder);
        vm.expectRevert(bytes("not signer"));
        ISessionAccount(root).execute(address(usdc), 0, "");
    }

    function test_revert_non_admin_add_signer() public {
        vm.prank(root);
        ISessionAccount(root).add_signer(session);
        // session signers can execute but NOT mint new signers
        vm.prank(session);
        vm.expectRevert(bytes("not admin"));
        ISessionAccount(root).add_signer(intruder);
    }

    function test_remove_signer_revokes() public {
        vm.startPrank(root);
        ISessionAccount(root).add_signer(session);
        ISessionAccount(root).remove_signer(session);
        vm.stopPrank();
        vm.prank(session);
        vm.expectRevert(bytes("not signer"));
        ISessionAccount(root).execute(address(usdc), 0, "");
    }

    function test_manager_chain_root_manages_role_account() public {
        // role account initialized with root as manager
        ISessionAccount(role).initialize(root);
        // root adds the session key on the ROLE account (msg.sender == manager)
        vm.prank(root);
        ISessionAccount(role).add_signer(session);
        // session key now operates the role account
        usdc.mint(role, 10e6);
        vm.prank(session);
        ISessionAccount(role).execute(
            address(usdc), 0, abi.encodeCall(MockUSDC.transfer, (session, 1e6))
        );
        assertEq(usdc.balanceOf(session), 1e6);
    }

    function test_session_hop_through_root_manages_role() public {
        // session key -> root.execute(role.add_signer(session)): msg.sender at role == root == manager
        ISessionAccount(role).initialize(root);
        vm.prank(root);
        ISessionAccount(root).add_signer(session);
        vm.prank(session);
        ISessionAccount(root).execute(
            role, 0, abi.encodeCall(ISessionAccount.add_signer, (session))
        );
        assertTrue(ISessionAccount(role).signers(session));
    }

    function test_revert_double_initialize() public {
        ISessionAccount(role).initialize(root);
        vm.expectRevert(bytes("initialized"));
        ISessionAccount(role).initialize(intruder);
    }

    function test_execute_batch_and_value_forwarding() public {
        vm.prank(root);
        ISessionAccount(root).add_signer(session);
        vm.deal(root, 1 ether); // native USDC (18-dec view)
        ISessionAccount.Call[] memory calls = new ISessionAccount.Call[](2);
        calls[0] = ISessionAccount.Call(session, 0.5 ether, "");
        calls[1] = ISessionAccount.Call(
            address(usdc), 0, abi.encodeCall(MockUSDC.transfer, (session, 2e6))
        );
        vm.prank(session);
        ISessionAccount(root).execute_batch(calls);
        assertEq(session.balance, 0.5 ether);
        assertEq(usdc.balanceOf(session), 2e6);
    }
}

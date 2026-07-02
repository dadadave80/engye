// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

/// Deploys the ENGYE contract system (Vyper) to Arc testnet.
/// Usage: cd contracts && forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$BROKER_PRIVATE_KEY" --broadcast
contract Deploy is Script {
    function _deploy(string memory artifact, bytes memory args) internal returns (address addr) {
        bytes memory initcode = abi.encodePacked(vm.getCode(artifact), args);
        assembly {
            addr := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(addr != address(0), "deploy failed");
    }

    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        // broker treasury doubles as resolver for the hackathon (trust assumption in README)
        address resolver = vm.envAddress("BROKER_ADDRESS");
        bytes memory args = abi.encode(usdc, resolver);

        vm.startBroadcast();
        address escrow = _deploy("BondedEscrow", args);
        address vault = _deploy("RefundVault", args);
        address stake = _deploy("ProviderStake", args);
        vm.stopBroadcast();

        console.log("ESCROW_ADDRESS=", escrow);
        console.log("REFUND_VAULT_ADDRESS=", vault);
        console.log("PROVIDER_STAKE_ADDRESS=", stake);
        console.log("usdc:", usdc);
        console.log("resolver:", resolver);
    }
}

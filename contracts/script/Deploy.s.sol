// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

/// Deploys the Vyper BondedEscrow to Arc testnet.
/// Usage: cd contracts && forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$BROKER_PRIVATE_KEY" --broadcast
contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        // broker treasury doubles as resolver for the hackathon (trust assumption in README)
        address resolver = vm.envAddress("BROKER_ADDRESS");

        vm.startBroadcast();
        bytes memory initcode = abi.encodePacked(vm.getCode("BondedEscrow"), abi.encode(usdc, resolver));
        address escrow;
        assembly {
            escrow := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(escrow != address(0), "deploy failed");
        vm.stopBroadcast();

        console.log("BondedEscrow deployed:", escrow);
        console.log("usdc:", usdc);
        console.log("resolver:", resolver);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IthacaAccount} from "account/IthacaAccount.sol";

/// Deploys the full ENGYE contract system to Arc testnet.
/// Run via scripts/deploy.sh — forge script --verify handles BOTH Vyper and Solidity
/// verification on Blockscout when contracts are deployed with explicit artifact ids.
contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        // broker treasury doubles as resolver for the hackathon (trust assumption in README)
        address resolver = vm.envAddress("BROKER_ADDRESS");
        bytes memory args = abi.encode(usdc, resolver);

        vm.startBroadcast();
        address escrow = vm.deployCode("BondedEscrow.vy:BondedEscrow", args);
        address vault = vm.deployCode("RefundVault.vy:RefundVault", args);
        address stake = vm.deployCode("ProviderStake.vy:ProviderStake", args);
        address delegate = vm.deployCode("SessionAccount.vy:SessionAccount");
        // orchestrator(0): we don't use Ithaca's gas-sponsored relay; session EOA relays intents
        address ithaca = address(new IthacaAccount(address(0)));
        vm.stopBroadcast();

        console.log("ESCROW_ADDRESS=", escrow);
        console.log("REFUND_VAULT_ADDRESS=", vault);
        console.log("PROVIDER_STAKE_ADDRESS=", stake);
        console.log("DELEGATE_ADDRESS=", delegate);
        console.log("ITHACA_IMPL=", ithaca);
    }
}

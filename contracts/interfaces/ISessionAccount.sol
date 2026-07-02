// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ISessionAccount {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event Initialized(address indexed manager);
    event SignerAdded(address indexed signer, address indexed by);
    event SignerRemoved(address indexed signer, address indexed by);
    event Executed(address indexed by, address indexed target, uint256 value);

    function manager() external view returns (address);
    function signers(address signer) external view returns (bool);

    function initialize(address managerAddr) external;
    function add_signer(address signer) external;
    function remove_signer(address signer) external;
    function execute(address target, uint256 value, bytes calldata data)
        external
        payable
        returns (bytes memory);
    function execute_batch(Call[] calldata calls) external payable;
}

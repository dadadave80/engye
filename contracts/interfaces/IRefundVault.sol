// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IRefundVault {
    event VaultFunded(address indexed funder, uint256 amount);
    event RefundPaid(bytes32 indexed match_id, address indexed to, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    function usdc() external view returns (address);
    function resolver() external view returns (address);
    function refunded(bytes32 matchId) external view returns (uint256);

    function fund(uint256 amount) external;
    function refund(bytes32 matchId, address to, uint256 amount) external;
    function sweep(address to, uint256 amount) external;
}

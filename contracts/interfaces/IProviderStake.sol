// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IProviderStake {
    event Staked(address indexed provider, uint256 amount, uint256 total_stake);
    event UnstakeRequested(address indexed provider, uint256 amount, uint256 unlock_time);
    event UnstakeWithdrawn(address indexed provider, uint256 amount);
    event StakeSlashed(
        bytes32 indexed match_id, address indexed provider, address indexed requester, uint256 amount
    );

    function usdc() external view returns (address);
    function resolver() external view returns (address);
    function stakes(address provider) external view returns (uint256);
    function pending(address provider) external view returns (uint256 amount, uint256 unlockTime);
    function slashed_for(bytes32 matchId) external view returns (uint256);

    function stake(uint256 amount) external;
    function request_unstake(uint256 amount) external;
    function withdraw() external;
    function slash_stake(bytes32 matchId, address provider, address requester, uint256 amount)
        external
        returns (uint256);
}

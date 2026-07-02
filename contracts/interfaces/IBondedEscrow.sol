// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// Thin Solidity interface over src/BondedEscrow.vy — used by tests, scripts, and viem ABI.
interface IBondedEscrow {
    event BondPosted(bytes32 indexed match_id, address indexed poster, address indexed requester, uint256 amount);
    event BondReleased(bytes32 indexed match_id, address indexed poster, uint256 amount);
    event BondSlashed(bytes32 indexed match_id, address indexed requester, uint256 amount);

    function usdc() external view returns (address);
    function resolver() external view returns (address);
    function bonds(bytes32 matchId)
        external
        view
        returns (address poster, address requester, uint256 amount, uint8 status);

    function create_bond(bytes32 matchId, uint256 amount, address requester) external;
    function release(bytes32 matchId) external;
    function slash(bytes32 matchId) external;
}

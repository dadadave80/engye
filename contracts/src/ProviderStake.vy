# pragma version 0.4.3
"""
@title ENGYE ProviderStake
@notice Optional provider co-insurance. Providers stake USDC as skin-in-the-game;
        on a failed match the resolver slashes min(requested, stake) to the
        requester ON TOP of the broker's bond. Unstaking is cooldown-gated so a
        failing provider cannot front-run its own slash. The broker's routing
        LLM reads stake as a trust signal.
"""

from ethereum.ercs import IERC20

# longer than any match TTL (bonds default to 10 min) — exits stay slashable
UNSTAKE_COOLDOWN: public(constant(uint256)) = 3600

struct PendingUnstake:
    amount: uint256
    unlock_time: uint256

usdc: public(immutable(IERC20))
resolver: public(immutable(address))
stakes: public(HashMap[address, uint256])
pending: public(HashMap[address, PendingUnstake])
slashed_for: public(HashMap[bytes32, uint256])  # match_id -> amount (once per match)

event Staked:
    provider: indexed(address)
    amount: uint256
    total_stake: uint256

event UnstakeRequested:
    provider: indexed(address)
    amount: uint256
    unlock_time: uint256

event UnstakeWithdrawn:
    provider: indexed(address)
    amount: uint256

event StakeSlashed:
    match_id: indexed(bytes32)
    provider: indexed(address)
    requester: indexed(address)
    amount: uint256

@deploy
def __init__(usdc_addr: address, resolver_addr: address):
    assert usdc_addr != empty(address), "zero usdc"
    assert resolver_addr != empty(address), "zero resolver"
    usdc = IERC20(usdc_addr)
    resolver = resolver_addr

@external
def stake(amount: uint256):
    assert amount > 0, "zero amount"
    self.stakes[msg.sender] += amount
    log Staked(provider=msg.sender, amount=amount, total_stake=self.stakes[msg.sender])
    assert extcall usdc.transferFrom(msg.sender, self, amount), "transferFrom failed"

@external
def request_unstake(amount: uint256):
    # stake stays in self.stakes (slashable) until withdraw after cooldown
    assert amount > 0, "zero amount"
    assert self.stakes[msg.sender] >= amount, "insufficient stake"
    unlock: uint256 = block.timestamp + UNSTAKE_COOLDOWN
    # a new request folds in and resets the clock
    self.pending[msg.sender] = PendingUnstake(
        amount=self.pending[msg.sender].amount + amount, unlock_time=unlock
    )
    log UnstakeRequested(provider=msg.sender, amount=amount, unlock_time=unlock)

@external
def withdraw():
    p: PendingUnstake = self.pending[msg.sender]
    assert p.amount > 0, "nothing pending"
    assert block.timestamp >= p.unlock_time, "cooldown"
    # slashes during cooldown may have reduced the stake
    amount: uint256 = min(p.amount, self.stakes[msg.sender])
    assert amount > 0, "fully slashed"
    self.pending[msg.sender] = empty(PendingUnstake)
    self.stakes[msg.sender] -= amount
    log UnstakeWithdrawn(provider=msg.sender, amount=amount)
    assert extcall usdc.transfer(msg.sender, amount), "transfer failed"

@external
def slash_stake(match_id: bytes32, provider: address, requester: address, amount: uint256) -> uint256:
    assert msg.sender == resolver, "not resolver"
    assert requester != empty(address), "zero requester"
    assert self.slashed_for[match_id] == 0, "already slashed"
    slashed: uint256 = min(amount, self.stakes[provider])
    if slashed == 0:
        return 0
    self.slashed_for[match_id] = slashed
    self.stakes[provider] -= slashed
    log StakeSlashed(match_id=match_id, provider=provider, requester=requester, amount=slashed)
    assert extcall usdc.transfer(requester, slashed), "transfer failed"
    return slashed

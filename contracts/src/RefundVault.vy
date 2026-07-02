# pragma version 0.4.3
"""
@title ENGYE RefundVault
@notice Treasury float for price refunds on failed matches. Refunds are
        once-per-match ENFORCED ON-CHAIN — a crashed or retried settlement
        process can never double-refund. Float is publicly visible, so the
        dashboard's "ledger reconciles" banner is chain-truth, not DB-truth.
"""

from ethereum.ercs import IERC20

usdc: public(immutable(IERC20))
resolver: public(immutable(address))
refunded: public(HashMap[bytes32, uint256])  # match_id -> refunded amount (0 = none)

event VaultFunded:
    funder: indexed(address)
    amount: uint256

event RefundPaid:
    match_id: indexed(bytes32)
    to: indexed(address)
    amount: uint256

event Swept:
    to: indexed(address)
    amount: uint256

@deploy
def __init__(usdc_addr: address, resolver_addr: address):
    assert usdc_addr != empty(address), "zero usdc"
    assert resolver_addr != empty(address), "zero resolver"
    usdc = IERC20(usdc_addr)
    resolver = resolver_addr

@external
def fund(amount: uint256):
    assert amount > 0, "zero amount"
    log VaultFunded(funder=msg.sender, amount=amount)
    assert extcall usdc.transferFrom(msg.sender, self, amount), "transferFrom failed"

@external
def refund(match_id: bytes32, to: address, amount: uint256):
    assert msg.sender == resolver, "not resolver"
    assert to != empty(address), "zero to"
    assert amount > 0, "zero amount"
    assert self.refunded[match_id] == 0, "already refunded"
    self.refunded[match_id] = amount
    log RefundPaid(match_id=match_id, to=to, amount=amount)
    assert extcall usdc.transfer(to, amount), "transfer failed"

@external
def sweep(to: address, amount: uint256):
    # recover float (end of event); resolver-gated
    assert msg.sender == resolver, "not resolver"
    log Swept(to=to, amount=amount)
    assert extcall usdc.transfer(to, amount), "transfer failed"

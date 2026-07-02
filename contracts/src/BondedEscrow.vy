# pragma version 0.4.3
"""
@title ENGYE BondedEscrow
@notice The broker posts a USDC bond per match, sized by its own confidence.
        The resolver settles: release -> bond poster, slash -> requester.
@dev USDC on Arc testnet is the native asset's ERC-20 interface (6 decimals).
"""

from ethereum.ercs import IERC20

STATUS_OPEN: constant(uint8) = 1
STATUS_RELEASED: constant(uint8) = 2
STATUS_SLASHED: constant(uint8) = 3

struct Bond:
    poster: address
    requester: address
    amount: uint256
    status: uint8

event BondPosted:
    match_id: indexed(bytes32)
    poster: indexed(address)
    requester: indexed(address)
    amount: uint256

event BondReleased:
    match_id: indexed(bytes32)
    poster: indexed(address)
    amount: uint256

event BondSlashed:
    match_id: indexed(bytes32)
    requester: indexed(address)
    amount: uint256

usdc: public(immutable(IERC20))
resolver: public(immutable(address))
bonds: public(HashMap[bytes32, Bond])

@deploy
def __init__(usdc_addr: address, resolver_addr: address):
    assert usdc_addr != empty(address), "zero usdc"
    assert resolver_addr != empty(address), "zero resolver"
    usdc = IERC20(usdc_addr)
    resolver = resolver_addr

@external
def create_bond(match_id: bytes32, amount: uint256, requester: address):
    assert amount > 0, "zero amount"
    assert requester != empty(address), "zero requester"
    assert self.bonds[match_id].status == 0, "bond exists"
    self.bonds[match_id] = Bond(
        poster=msg.sender, requester=requester, amount=amount, status=STATUS_OPEN
    )
    log BondPosted(match_id=match_id, poster=msg.sender, requester=requester, amount=amount)
    assert extcall usdc.transferFrom(msg.sender, self, amount), "transferFrom failed"

@external
def release(match_id: bytes32):
    assert msg.sender == resolver, "not resolver"
    bond: Bond = self.bonds[match_id]
    assert bond.status == STATUS_OPEN, "not open"
    self.bonds[match_id].status = STATUS_RELEASED
    log BondReleased(match_id=match_id, poster=bond.poster, amount=bond.amount)
    assert extcall usdc.transfer(bond.poster, bond.amount), "transfer failed"

@external
def slash(match_id: bytes32):
    assert msg.sender == resolver, "not resolver"
    bond: Bond = self.bonds[match_id]
    assert bond.status == STATUS_OPEN, "not open"
    self.bonds[match_id].status = STATUS_SLASHED
    log BondSlashed(match_id=match_id, requester=bond.requester, amount=bond.amount)
    assert extcall usdc.transfer(bond.requester, bond.amount), "transfer failed"

# pragma version 0.4.3
"""
@title ENGYE SessionAccount — EIP-7702 delegate
@notice Minimal smart account for 7702-delegated EOAs (Ithaca-style, relay-free).
        Auth is msg.sender-based: the EOA's own key (msg.sender == self), an
        optional manager account, or registered session signers. The human's
        funded root delegates once and registers the agent's session key; the
        agent operates every role account without ever holding the root key.
@dev No constructor/immutables on purpose — 7702 delegates run in the EOA's
     storage context. initialize() is first-caller-wins; call it in the same
     type-4 transaction as the delegation to close the race.
"""

struct Call:
    target: address
    value: uint256
    data: Bytes[2048]

manager: public(address)
signers: public(HashMap[address, bool])

event Initialized:
    manager: indexed(address)

event SignerAdded:
    signer: indexed(address)
    by: indexed(address)

event SignerRemoved:
    signer: indexed(address)
    by: indexed(address)

event Executed:
    by: indexed(address)
    target: indexed(address)
    value: uint256

@external
def initialize(manager_addr: address):
    assert self.manager == empty(address), "initialized"
    assert manager_addr != empty(address), "zero manager"
    self.manager = manager_addr
    log Initialized(manager=manager_addr)

@view
@internal
def _is_authorized(sender: address) -> bool:
    return sender == self or sender == self.manager or self.signers[sender]

@view
@internal
def _is_admin(sender: address) -> bool:
    return sender == self or sender == self.manager

@external
def add_signer(signer: address):
    assert self._is_admin(msg.sender), "not admin"
    assert signer != empty(address), "zero signer"
    self.signers[signer] = True
    log SignerAdded(signer=signer, by=msg.sender)

@external
def remove_signer(signer: address):
    assert self._is_admin(msg.sender), "not admin"
    self.signers[signer] = False
    log SignerRemoved(signer=signer, by=msg.sender)

@payable
@external
def execute(target: address, call_value: uint256, data: Bytes[2048]) -> Bytes[1024]:
    assert self._is_authorized(msg.sender), "not signer"
    log Executed(by=msg.sender, target=target, value=call_value)
    return raw_call(target, data, value=call_value, max_outsize=1024)

@payable
@external
def execute_batch(calls: DynArray[Call, 10]):
    assert self._is_authorized(msg.sender), "not signer"
    for c: Call in calls:
        log Executed(by=msg.sender, target=c.target, value=c.value)
        raw_call(c.target, c.data, value=c.value)

@payable
@external
def __default__():
    # receive native USDC
    pass

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IthacaAccount} from "account/IthacaAccount.sol";
import {ERC7821} from "solady/accounts/ERC7821.sol";
import {P256} from "solady/utils/P256.sol";
import {Base64} from "solady/utils/Base64.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";
import {MockUSDC} from "./BondedEscrow.t.sol";

/// Proves the ROOT account model on IthacaAccount under real EIP-7702 delegation:
/// (1) root EOA key self-authorizes the agent's secp256k1 session key (super-admin),
/// (2) the session key signs an ERC-7821 intent any relayer can submit,
/// (3) a WebAuthn P256 passkey works the same way (synthetic authenticator payload).
contract IthacaRootTest is Test {
    bytes32 constant MODE = 0x0100000000007821000100000000000000000000000000000000000000000000;

    IthacaAccount impl;
    MockUSDC usdc;
    uint256 rootPk;
    address root;
    uint256 sessionPk;
    address session;
    address relayer = makeAddr("relayer");

    function setUp() public {
        impl = new IthacaAccount(address(0));
        (root, rootPk) = makeAddrAndKey("root");
        (session, sessionPk) = makeAddrAndKey("session");
        vm.signAndAttachDelegation(address(impl), rootPk);
        usdc = new MockUSDC();
        usdc.mint(root, 100e6);
        _etchP256Verifier();
    }

    function _acct() internal view returns (IthacaAccount) {
        return IthacaAccount(payable(root));
    }

    function _keyHash(IthacaAccount.Key memory k) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint8(k.keyType), keccak256(k.publicKey)));
    }

    function _transferCall(uint256 amount) internal view returns (ERC7821.Call[] memory calls) {
        calls = new ERC7821.Call[](1);
        calls[0] = ERC7821.Call(address(usdc), 0, abi.encodeCall(MockUSDC.transfer, (relayer, amount)));
    }

    function _authorizeAsRoot(IthacaAccount.Key memory k) internal returns (bytes32 kh) {
        vm.prank(root); // EOA root key sending to itself: msg.sender == address(this)
        kh = _acct().authorize(k);
    }

    function test_session_key_intent_relayed_by_anyone() public {
        IthacaAccount.Key memory k =
            IthacaAccount.Key(0, IthacaAccount.KeyType.Secp256k1, true, abi.encode(session));
        bytes32 kh = _authorizeAsRoot(k);
        assertEq(kh, _keyHash(k));

        ERC7821.Call[] memory calls = _transferCall(5e6);
        uint256 nonce = _acct().getNonce(0);
        bytes32 digest = _acct().computeDigest(calls, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionPk, digest);
        bytes memory wrapped = abi.encodePacked(abi.encodePacked(r, s, v), kh, uint8(0));
        bytes memory opData = abi.encodePacked(nonce, wrapped);

        vm.prank(relayer); // relayer-agnostic: session EOA submits its own intents on Arc
        _acct().execute(MODE, abi.encode(calls, opData));
        assertEq(usdc.balanceOf(relayer), 5e6);
    }

    function test_webauthn_passkey_intent() public {
        uint256 p256Pk = uint256(keccak256("engye-passkey")) % P256.N;
        (uint256 x, uint256 y) = vm.publicKeyP256(p256Pk);
        IthacaAccount.Key memory k =
            IthacaAccount.Key(0, IthacaAccount.KeyType.WebAuthnP256, true, abi.encode(x, y));
        bytes32 kh = _authorizeAsRoot(k);

        ERC7821.Call[] memory calls = _transferCall(3e6);
        uint256 nonce = _acct().getNonce(0);
        bytes32 digest = _acct().computeDigest(calls, nonce);

        // synthetic WebAuthn assertion (structure per solady WebAuthn.verify)
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encode(abi.encode(digest), true, true),
            '","origin":"https://engye.app"}'
        );
        bytes memory authenticatorData =
            abi.encodePacked(keccak256("engye.app"), bytes1(0x05), bytes4(0)); // UP+UV flags
        bytes32 msgHash = sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(p256Pk, msgHash);
        s = P256.normalized(s);

        WebAuthn.WebAuthnAuth memory auth = WebAuthn.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: 23,
            typeIndex: 1,
            r: r,
            s: s
        });
        bytes memory wrapped = abi.encodePacked(abi.encode(auth), kh, uint8(0));
        bytes memory opData = abi.encodePacked(nonce, wrapped);

        vm.prank(relayer);
        _acct().execute(MODE, abi.encode(calls, opData));
        assertEq(usdc.balanceOf(relayer), 3e6);
    }

    function test_revert_unauthorized_key() public {
        (, uint256 stragerPk) = makeAddrAndKey("stranger");
        ERC7821.Call[] memory calls = _transferCall(1e6);
        uint256 nonce = _acct().getNonce(0);
        bytes32 digest = _acct().computeDigest(calls, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(stragerPk, digest);
        // wrap with a keyHash that was never authorized
        bytes memory wrapped =
            abi.encodePacked(abi.encodePacked(r, s, v), keccak256("nope"), uint8(0));
        vm.expectRevert();
        _acct().execute(MODE, abi.encode(calls, abi.encodePacked(nonce, wrapped)));
    }

    // solady's canonical p256 verifier bytecode, etched at the RIP-7212 slot (absent in local EVM)
    function _etchP256Verifier() internal {
        bytes memory verifierBytecode =
            hex"3d604052610216565b60008060006ffffffffeffffffffffffffffffffffff60601b19808687098188890982838389096004098384858485093d510985868b8c096003090891508384828308850385848509089650838485858609600809850385868a880385088509089550505050808188880960020991505093509350939050565b81513d83015160408401516ffffffffeffffffffffffffffffffffff60601b19808384098183840982838388096004098384858485093d510985868a8b096003090896508384828308850385898a09089150610102848587890960020985868787880960080987038788878a0387088c0908848b523d8b015260408a0152565b505050505050505050565b81513d830151604084015185513d87015160408801518361013d578287523d870182905260408701819052610102565b80610157578587523d870185905260408701849052610102565b6ffffffffeffffffffffffffffffffffff60601b19808586098183840982818a099850828385830989099750508188830383838809089450818783038384898509870908935050826101be57836101be576101b28a89610082565b50505050505050505050565b808485098181860982828a09985082838a8b0884038483860386898a09080891506102088384868a0988098485848c09860386878789038f088a0908848d523d8d015260408c0152565b505050505050505050505050565b6020357fffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325513d6040357f7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a88111156102695782035b60206108005260206108205260206108405280610860526002830361088052826108a0526ffffffffeffffffffffffffffffffffff60601b198060031860205260603560803560203d60c061080060055afa60203d1416837f5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b8585873d5189898a09080908848384091484831085851016888710871510898b108b151016609f3611161616166103195760206080f35b60809182523d820152600160c08190527f6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2966102009081527f4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f53d909101526102405261038992509050610100610082565b610397610200610400610082565b6103a7610100608061018061010d565b6103b7610200608061028061010d565b6103c861020061010061030061010d565b6103d961020061018061038061010d565b6103e9610400608061048061010d565b6103fa61040061010061050061010d565b61040b61040061018061058061010d565b61041c61040061020061060061010d565b61042c610600608061068061010d565b61043d61060061010061070061010d565b61044e61060061018061078061010d565b81815182350982825185098283846ffffffffeffffffffffffffffffffffff60601b193d515b82156105245781858609828485098384838809600409848586848509860986878a8b096003090885868384088703878384090886878887880960080988038889848b03870885090887888a8d096002098882830996508881820995508889888509600409945088898a8889098a098a8b86870960030908935088898687088a038a868709089a5088898284096002099950505050858687868709600809870387888b8a0386088409089850505050505b61018086891b60f71c16610600888a1b60f51c16176040810151801585151715610564578061055357506105fe565b81513d8301519750955093506105fe565b83858609848283098581890986878584098b0991508681880388858851090887838903898a8c88093d8a015109089350836105b957806105b9576105a9898c8c610008565b9a509b50995050505050506105fe565b8781820988818309898285099350898a8586088b038b838d038d8a8b0908089b50898a8287098b038b8c8f8e0388088909089c5050508788868b098209985050505050505b5082156106af5781858609828485098384838809600409848586848509860986878a8b096003090885868384088703878384090886878887880960080988038889848b03870885090887888a8d096002098882830996508881820995508889888509600409945088898a8889098a098a8b86870960030908935088898687088a038a868709089a5088898284096002099950505050858687868709600809870387888b8a0386088409089850505050505b61018086891b60f51c16610600888a1b60f31c161760408101518015851517156106ef57806106de5750610789565b81513d830151975095509350610789565b83858609848283098581890986878584098b0991508681880388858851090887838903898a8c88093d8a01510908935083610744578061074457610734898c8c610008565b9a509b5099505050505050610789565b8781820988818309898285099350898a8586088b038b838d038d8a8b0908089b50898a8287098b038b8c8f8e0388088909089c5050508788868b098209985050505050505b50600488019760fb19016104745750816107a2573d6040f35b81610860526002810361088052806108a0523d3d60c061080060055afa898983843d513d510987090614163d525050505050505050503d3df3fea264697066735822122063ce32ec0e56e7893a1f6101795ce2e38aca14dd12adb703c71fe3bee27da71e64736f6c634300081a0033";
        vm.etch(address(0x100), verifierBytecode);
    }
}

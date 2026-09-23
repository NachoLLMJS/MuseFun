> For the complete documentation index, see [llms.txt](https://docs.flap.sh/flap/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.flap.sh/flap/developers/token-launcher-developers/launch-token-through-portal.md).

# Launch token through Portal

This page explains how to launch a token directly through `Portal`. The current launch entry points are:

* `newTokenV6` for `TOKEN_V2_PERMIT` and all currently supported tax-token versions (`TOKEN_TAXED`, `TOKEN_TAXED_V2`, `TOKEN_TAXED_V3`)
* `newTokenV7` for `TOKEN_V3_PERMIT`, the TokenV3-based non-tax flow used for CL-style migration

Legacy methods (`newTokenV2`, `newTokenV3`, `newTokenV4`, `newTokenV5`) remain available for backward compatibility.

{% hint style="info" %}
`TOKEN_TAXED_V3` (`FlapTaxTokenV3`) is the recommended token type for all new tax token launches. It supports asymmetric buy/sell tax rates, commission receivers, and bidirectional dynamic liquidation thresholds. Use `newTokenV6` with `tokenVersion = TOKEN_TAXED_V3` for new integrations.
{% endhint %}

{% hint style="info" %}
`TOKEN_V3_PERMIT` is launched through `newTokenV7`, not `newTokenV6`. Use it when you want the TokenV3 non-tax path together with CL-style migration.
{% endhint %}

## 1) Prepare token metadata

Token metadata is stored on IPFS. You can upload your image and metadata JSON through the Flap upload API.

Example (TypeScript):

```typescript
async function uploadTokenMeta(cfg: {
    buy: string | null;
    creator: string;
    description: string;
    sell: string | null;
    telegram: string | null;
    twitter: string | null;
    website: string | null;
    image_path: string;
}) {
    const form = new FormData();

    const MUTATION_CREATE = `
    mutation Create($file: Upload!, $meta: MetadataInput!) {
      create(file: $file, meta: $meta)
    }
    `;

    form.append(
        "operations",
        JSON.stringify({
            query: MUTATION_CREATE,
            variables: {
                file: null, meta: {
                    website: cfg.website,
                    twitter: cfg.twitter,
                    telegram: cfg.telegram,
                    description: cfg.description,
                    creator: "0x0000000000000000000000000000000000000000",
                }
            },
        })
    );

    form.append(
        "map",
        JSON.stringify({
            "0": ["variables.file"],
        })
    );

    const file = new File([fs.readFileSync(cfg.image_path)], "image.png", {
        type: "image/png",
    });
    form.append("0", file);

    const res = await axios.postForm(FlapConfig.api, form, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });

    if (res.status !== 200) {
        throw new Error(`failed to upload the token meta: ${res.statusText}`);
    }

    const cid = res.data.data.create;
    return cid;
}
```

{% hint style="warning" %}
You must upload the image to IPFS and pin the metadata using our API: <https://funcs.flap.sh/api/upload>.

Our indexer will not be able to fetch your file if it is not pinned on our gateway. Besides, many terminals fetch files through our gateway and we will warm the CDN on upload to improve loading speed.

If your file or directory is already available on Public IPFS and you only need the Flap Pinata account to retain the existing CID, use [Pin Existing IPFS Content](/flap/developers/pin-existing-ipfs-content.md) instead of uploading the same content again.
{% endhint %}

## 2) Call `newTokenV6`

`newTokenV6` is the recommended unified entry point for all token types. The token implementation is selected via the `tokenVersion` field.

```solidity
/// @notice Create a new token (V6) — unified entry point for all token versions.
/// @param params The parameters for the new token (see NewTokenV6Params).
/// @return token The address of the created token.
function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);
```

`NewTokenV6Params` covers all token types via `tokenVersion`:

```solidity
struct NewTokenV6Params {
    string name;
    string symbol;
    string meta;
    DexThreshType dexThresh;
    bytes32 salt;
    MigratorType migratorType;
    address quoteToken;
    uint256 quoteAmt;
    address beneficiary;
    bytes permitData;
    bytes32 extensionID;
    bytes extensionData;
    DEXId dexId;
    V3LPFeeProfile lpFeeProfile;
    // Tax fields (set to 0 for non-tax tokens)
    uint16 buyTaxRate;
    uint16 sellTaxRate;
    uint64 taxDuration;
    uint64 antiFarmerDuration;
    uint16 mktBps;
    uint16 deflationBps;
    uint16 dividendBps;
    uint16 lpBps;
    uint256 minimumShareBalance;
    // V3-only fields
    address dividendToken;
    address commissionReceiver;
    TokenVersion tokenVersion;
}
```

### Token version dispatch

The `tokenVersion` field controls which token implementation is created:

| `tokenVersion`    | Token type                  | Notes                                                                                                          |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `TOKEN_V2_PERMIT` | Standard ERC-20 with permit | Set both tax rates to 0, `commissionReceiver` must be `address(0)`                                             |
| `TOKEN_TAXED`     | FlapTaxToken V1             | Legacy; symmetric rates only, `mktBps` must be 10000, no commission. **Not recommended for new launches.**     |
| `TOKEN_TAXED_V2`  | FlapTaxTokenV2              | Legacy; symmetric rates only, `mktBps` must not be 10000, no commission. **Not recommended for new launches.** |
| `TOKEN_TAXED_V3`  | FlapTaxTokenV3              | **Recommended.** Asymmetric rates, commission supported.                                                       |

{% hint style="warning" %}
`TOKEN_TAXED` and `TOKEN_TAXED_V2` are deprecated. New integrations should always use `TOKEN_TAXED_V3`.
{% endhint %}

`TOKEN_V3_PERMIT` is intentionally not part of `newTokenV6`. Use `newTokenV7` for that launch path.

### Launching a Tax Token V3 (recommended)

Set `tokenVersion = TOKEN_TAXED_V3` and fill in the tax fields:

```typescript
import { parseEther, zeroAddress } from "viem";

const params = {
    name: "My Token",
    symbol: "MTK",
    meta: "<ipfs-cid>",
    dexThresh: DexThreshType.TWO_THIRDS,
    salt, // must produce 7777 vanity suffix
    migratorType: MigratorType.V2_MIGRATOR,
    quoteToken: zeroAddress, // native gas token
    quoteAmt: parseEther("0.01"),
    beneficiary: beneficiaryAddress,
    permitData: "0x",
    extensionID: "0x0000000000000000000000000000000000000000000000000000000000000000",
    extensionData: "0x",
    dexId: DEXId.DEX0,
    lpFeeProfile: V3LPFeeProfile.LP_FEE_PROFILE_STANDARD,
    buyTaxRate: 300, // 3%
    sellTaxRate: 1000, // 10%
    taxDuration: 365n * 24n * 60n * 60n,
    antiFarmerDuration: 60n * 60n,
    mktBps: 10000, // all tax to beneficiary (after protocol fee)
    deflationBps: 0,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0n,
    dividendToken: zeroAddress, // Case 2: quote token (zeroAddress = native)
    // Case 1: 0xfEEDFEEDfeEDFEedFEEdFEEDFeEdfEEdFeEdFEEd (MAGIC_DIVIDEND_SELF = launching token itself)
    // Case 3: any ERC-20 supported by SwapRegistry
    commissionReceiver: zeroAddress, // set to your address to earn commission
    tokenVersion: TokenVersion.TOKEN_TAXED_V3,
};

const hash = await walletClient.writeContract({
    address: portalAddress,
    abi: portalAbi,
    functionName: "newTokenV6",
    args: [params],
    value: parseEther("0.01"),
});
```

Key notes:

* `meta` is the IPFS CID of your metadata JSON.
* `migratorType` must be `V2_MIGRATOR` for tax tokens.
* `quoteToken = address(0)` uses the native gas token.
* `salt` must produce the required vanity suffix: `7777` for tax tokens, `8888` for standard tokens.
* `mktBps + deflationBps + dividendBps + lpBps` must equal 10000.
* `dividendToken` supports three modes: **Case 1** — `0xfEEDFEEDfeEDFEedFEEdFEEDFeEdfEEdFeEdFEEd` (`MAGIC_DIVIDEND_SELF`, distributes the launching token itself); **Case 2** — `address(0)` or the quote token address (most common); **Case 3** — any ERC-20 that has a registered swap path in `SwapRegistry`. See [Tax Token V3](/flap/developers/basic-and-mechanism/flap-tax-token/tax-token-v3.md#dividend-token) for full details.
* Set `commissionReceiver` to your address to earn a protocol-calculated commission from every taxable transaction.

### Launching a standard token

Set `tokenVersion = TOKEN_V2_PERMIT` and all tax fields to 0:

```solidity
function launchStandardToken(IPortal portal) external payable returns (address token) {
    IPortalTypes.NewTokenV6Params memory params = IPortalTypes.NewTokenV6Params({
        // ... base fields ...
        buyTaxRate:         0,
        sellTaxRate:        0,
        // ... other tax fields = 0 ...
        commissionReceiver: address(0),
        tokenVersion:       IPortalTypes.TokenVersion.TOKEN_V2_PERMIT
    });

    token = portal.newTokenV6{value: msg.value}(params);
}
```

## 3) Call `newTokenV7`

`newTokenV7` is the TokenV3-based launch entry point. It is intended for CL-style migration and introduces `feeConfigs`, which replace the old `beneficiary + mktBps/deflationBps/dividendBps/lpBps` split used by `newTokenV6` tax launches.

```solidity
/// @notice Create a new token with V4/PCS Infinity migration support
/// @param params The V7 token parameters
/// @return token The created token address
function newTokenV7(NewTokenV7Params calldata params) external payable returns (address token);

enum FeeType {
    NONE,
    MARKETING_OR_VAULT,
    DIVIDEND,
    DEFLATION,
    LP_BPS
}

struct FeeConfig {
    FeeType feeType;
    uint16 bps;
    address marketingAddress;
    address dividendToken;
    uint256 minimumShareBalance;
}

struct NewTokenV7Params {
    string name;
    string symbol;
    string meta;
    DexThreshType dexThresh;
    bytes32 salt;
    MigratorType migratorType;
    address quoteToken;
    uint256 quoteAmt;
    bytes permitData;
    bytes32 extensionID;
    bytes extensionData;
    DEXId dexId;
    uint16 buyTaxRate;
    uint16 sellTaxRate;
    uint64 taxDuration;
    uint64 antiFarmerDuration;
    address commissionReceiver;
    TokenVersion tokenVersion;
    FeeConfig[4] feeConfigs;
}
```

### Current `newTokenV7` rollout details

The interface includes both `TOKEN_V3_PERMIT` and `TOKEN_TAXED_V3` paths, but the current implementation is narrower:

* Public `newTokenV7` launches currently support `TOKEN_V3_PERMIT` only.
* `TOKEN_TAXED_V3` through `newTokenV7` currently reverts with `NewTokenV7RuleViolation(4)`.
* For tax-token launches, keep using `newTokenV6`.
* The current implementation accepts `PCS_INFINITY_CL_MIGRATOR` for the public `TOKEN_V3_PERMIT` path.
* `commissionReceiver` must be `address(0)` for `TOKEN_V3_PERMIT`.
* `buyTaxRate` and `sellTaxRate` must both be `0` for `TOKEN_V3_PERMIT`.
* `antiFarmerDuration` must not exceed `365 days`.

{% hint style="warning" %}
Although `MigratorType` includes `V4_UNI_MIGRATOR`, the current `TOKEN_V3_PERMIT` implementation behind `newTokenV7` validates against `PCS_INFINITY_CL_MIGRATOR`. If you send any other migrator type on the public path, the call reverts with `InvalidMigratorType()`.
{% endhint %}

### How `feeConfigs` work

`feeConfigs` has 4 fixed slots. General validation rules from the launcher are:

* every slot with `feeType != NONE` must have `bps > 0`
* duplicate fee types are not allowed
* all active slots together must sum to exactly `10000` bps
* `MARKETING_OR_VAULT` requires a non-zero `marketingAddress`
* `DIVIDEND` uses `dividendToken` and `minimumShareBalance`

For the current public `TOKEN_V3_PERMIT` rollout, there are extra restrictions:

* only **one** active fee mode is currently supported
* supported mode A: a single `MARKETING_OR_VAULT` slot with `bps = 10000`
* supported mode B: a single `DIVIDEND` slot with `bps = 10000` and `dividendToken == quoteToken`
* `DEFLATION` and `LP_BPS` are not enabled yet for `TOKEN_V3_PERMIT` and revert with `UnsupportedV7TokenV3PermitFeeType(...)`

There is no standalone `beneficiary` field in `NewTokenV7Params`. If you use `MARKETING_OR_VAULT`, the first such slot's `marketingAddress` becomes the primary beneficiary used by the launcher.

### Example: zero-tax `TOKEN_V3_PERMIT` launch

```typescript
const zeroAddress = "0x0000000000000000000000000000000000000000";

const params = {
    name: "My CL Token",
    symbol: "MCL",
    meta: "<ipfs-cid>",
    dexThresh: DexThreshType.FOUR_FIFTHS,
    salt: vanitySalt, // must produce 8888 suffix
    migratorType: MigratorType.PCS_INFINITY_CL_MIGRATOR,
    quoteToken: zeroAddress,
    quoteAmt: parseEther("0.1"),
    permitData: "0x",
    extensionID: "0x0000000000000000000000000000000000000000000000000000000000000000",
    extensionData: "0x",
    dexId: DEXId.DEX0,
    buyTaxRate: 0,
    sellTaxRate: 0,
    taxDuration: 0,
    antiFarmerDuration: 0,
    commissionReceiver: zeroAddress,
    tokenVersion: TokenVersion.TOKEN_V3_PERMIT,
    feeConfigs: [
        {
            feeType: FeeType.MARKETING_OR_VAULT,
            bps: 10000,
            marketingAddress: beneficiaryAddress,
            dividendToken: zeroAddress,
            minimumShareBalance: 0n,
        },
        {
            feeType: FeeType.NONE,
            bps: 0,
            marketingAddress: zeroAddress,
            dividendToken: zeroAddress,
            minimumShareBalance: 0n,
        },
        {
            feeType: FeeType.NONE,
            bps: 0,
            marketingAddress: zeroAddress,
            dividendToken: zeroAddress,
            minimumShareBalance: 0n,
        },
        {
            feeType: FeeType.NONE,
            bps: 0,
            marketingAddress: zeroAddress,
            dividendToken: zeroAddress,
            minimumShareBalance: 0n,
        },
    ],
};

const tx = await portal.newTokenV7(params, { value: params.quoteAmt });
```

If you use the dividend-only mode instead of the marketing mode, set exactly one `DIVIDEND` slot with `bps = 10000`, and set `dividendToken` to the same address as `quoteToken`.

## 4) Find the salt (vanity suffix)

`Portal` uses CREATE2 for deterministic deployments. The `salt` must produce a token address with the required suffix:

* Non-tax token: address ends with `8888`.
* Tax token: address ends with `7777`.

To find a valid `salt`, repeatedly hash a random seed and check the predicted address until it matches the suffix. You can predict the address using CREATE2 with the `Portal` address and the token implementation address for the token type you’re launching.

Example (TypeScript):

```typescript
/// Find a vanity salt by predicting the CREATE2 address.
async function findVanityTokenSalt(suffix: string, tokenImpl: Address, portal: Address) {
    if (suffix.length !== 4) {
        throw new Error("Suffix must be exactly 4 characters");
    }

    const predictVanityTokenAddress = (salt: Hex): Address => {
        const bytecode = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73"
            + tokenImpl.slice(2).toLowerCase()
            + "5af43d82803e903d91602b57fd5bf3" as Hex;

        return getContractAddress({
            from: portal,
            salt: toBytes(salt),
            bytecode,
            opcode: "CREATE2",
        });
    };

    // you don't need to use privatekey, you can use any random seed as long as it is unique for each attempt. Using a privatekey is just a convenient way to get a random 32-byte value.
    const seed = generatePrivateKey();
    let salt = keccak256(toHex(seed));
    let iterations = 0;

    while (!predictVanityTokenAddress(salt).endsWith(suffix)) {
        salt = keccak256(salt);
        iterations++;
    }

    return {
        salt,
        address: predictVanityTokenAddress(salt),
        iterations,
    };
}
```

Use the correct `tokenImpl` and `portal` addresses for your network (see the deployed addresses page in this section).

Token implementation selection for launch methods:

* `TOKEN_V2_PERMIT` (standard token): use the **Standard Token Impl** (`tokenImplV2`).
* `TOKEN_TAXED_V3` (recommended tax token): use the **Tax Token V3 Impl** (`tokenImplTaxedV3`).
* `TOKEN_TAXED` (legacy V1, not recommended): use the **Tax Token V1 Impl** (`tokenImplTaxed`).
* `TOKEN_TAXED_V2` (legacy V2, not recommended): use the **Tax Token V2 Impl** (`tokenImplTaxedV2`).
* `TOKEN_V3_PERMIT` via `newTokenV7`: use the **Standard Token V3 Impl**. It is still a non-tax launch, so the vanity suffix is `8888`.

See [deployed-contract-addresses.md](/flap/developers/token-launcher-developers/deployed-contract-addresses.md) for the exact implementation addresses.

{% hint style="warning" %}
For new launches, always use `tokenImplTaxedV3` when computing salts for tax tokens. Legacy tax token implementations (`TOKEN_TAXED`, `TOKEN_TAXED_V2`) are deprecated and should not be used for new integrations.
{% endhint %}

{% hint style="warning" %}
`newTokenV7` currently does not expose a public `TOKEN_TAXED_V3` rollout. For tax-token launches, compute the salt against the `newTokenV6` implementation path and use `newTokenV6`.
{% endhint %}

## 5) Legacy methods

`newTokenV2`, `newTokenV3`, `newTokenV4`, and `newTokenV5` are still supported for legacy integrations. They follow the same flow but provide fewer features than the current launch paths. New integrations should use `newTokenV6` for tax tokens and `TOKEN_V2_PERMIT`, or `newTokenV7` for `TOKEN_V3_PERMIT`.

## IPortal.sol

Full interface reference for developers:

```solidity
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import {IAccessControlUpgradeable} from "@openzeppelin-contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import {IUniswapV3MintCallback} from "uni-v3-core/interfaces/callback/IUniswapV3MintCallback.sol";
import {IPancakeV3MintCallback} from "pancake-v3-core/interfaces/callback/IPancakeV3MintCallback.sol";

/// @dev Magic address value for `dividendToken` in NewTokenV6Params.
///      When set to this address, the dividend token is resolved to the tax token's own address
///      after it is created. This is a sugar for devs who do not want to pre-compute the tax token
///      address (it is deterministically computed from the salt).
///      Uses a well-known non-conflicting sentinel (0xfEED...fEED) to avoid conflict with:
///        - address(0): native gas token dividend (only valid when quoteToken is also native gas)
///        - any ERC-20 address: use that token as dividend (including quoteToken)
address constant MAGIC_DIVIDEND_SELF = address(0xfEEDFEEDfeEDFEedFEEdFEEDFeEdfEEdFeEdFEEd);

/// @title Common Types
/// @notice This interface defines common types shared across the portal
interface IPortalCommonTypes {
    /// @dev curve Types
    enum CurveType {
        CURVE_LEGACY_15, // r = 15
        CURVE_4, // r = 4
        CURVE_0_974, // r = 0.974
        CURVE_0_5, // r = 0.5
        CURVE_1000, // r = 1000
        CURVE_20000, // r = 20000
        CURVE_2500, // r = 2500
        CURVE_500, // r = 500
        CURVE_2, // r = 2
        CURVE_6, // r = 6
        CURVE_75, // r = 75
        CURVE_4M, // r= 4 M
        CURVE_28, // r = 28
        CURVE_21_25, // r = 21.25
        CURVE_RH_UNUSED, // r = 27.6, h = 352755468
        CURVE_RH_28D25_108002126, // r = 28.25, h = 108002126, k = 31301060059.5
        CURVE_RH_14981_108002125, // r = 14981, h = 108002125, k = 16598979834625
        CURVE_RH_TOSHI_MORPH_2ETH, // r = 0.7672, h = 107036751, k = 849318595.3672 - TOSHI/MORPH 2ETH curve
        CURVE_RH_TOSHI, // r = 6140351, h = 107036752, k = 6797594227179952 - TOSHI Curve
        CURVE_RH_BGB, // r = 767.5, h = 107036752, k = 849650707160 - BGB curve
        CURVE_RH_

... [OUTPUT TRUNCATED - 63,071 chars omitted out of 112,997 total] ...

5) and create it
    /// @param params The parameters for token deployment (includes salt to identify staged token)
    /// @dev This deploys the token contract and initializes it. The token must have been staged first via stageNewTokenV5.
    ///      The salt and isTaxToken in params must match what was used during staging.
    ///      If taxRate > 0, creates FlapTaxTokenV2, otherwise creates regular token.
    /// FIXME: this is not enabled in this version. Will be available once the audit for this part is ready.
    function commitNewTokenV5(CommitNewTokenV5Params calldata params) external payable;
}

/// @notice Handles token creation and related operations
interface IPortalLauncher is IPortalTypes {
    /// @notice Create a new token (V2) with flexible parameters
    /// @param params The parameters for the new token
    /// @return token The address of the created
    /// @dev due to the implementation limit, when creating a tax token and using an ERC20 token as the quote token,
    /// You need to pay an extra 1gwei native gas token (i.e msg.value = 1 gwei), or you will encounter an InsufficientValueForTaxTokenCreation error
    function newTokenV2(NewTokenV2Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V3) with extension support
    /// @param params The parameters for the new token including extension configuration
    /// @return token The address of the created token
    /// @dev Similar to newTokenV2 but with extension support. Extension hooks will be called if extensionID is non-zero
    function newTokenV3(NewTokenV3Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V4) with DEX ID and LP fee profile support
    /// @param params The parameters for the new token including DEX ID and LP fee profile
    /// @return token The address of the created token
    /// @dev Similar to newTokenV3 but with DEX ID and LP fee profile support. Allows specifying preferred DEX and fee tier
    function newTokenV4(NewTokenV4Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V5) with tax V2 support
    /// @param params The parameters for the new token including advanced tax features
    /// @return token The address of the created token
    /// @dev Similar to newTokenV4 but with support for FlapTaxTokenV2 when taxRate > 0.
    ///      When taxRate is 0, behaves like newTokenV4 (uses regular token or FlapTaxToken).
    ///      When taxRate > 0, creates a FlapTaxTokenV2 with advanced tax distribution features.
    /// FIXME: this is not enabled in this version. Will be available once the audit for this part is ready.
    function newTokenV5(NewTokenV5Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V6) — unified entry point for all token versions.
    /// @param params The parameters for the new token (see NewTokenV6Params).
    /// @return token The address of the created token.
    ///
    /// @dev Dispatch logic based on `params.tokenVersion`:
    ///
    ///   TOKEN_V2_PERMIT (non-tax token):
    ///     - buyTaxRate and sellTaxRate MUST both be 0.
    ///     - commissionReceiver MUST be address(0).
    ///     - Dispatched to PortalLauncherV5 → creates a standard ERC-20 (TOKEN_V2_PERMIT).
    ///
    ///   TOKEN_TAXED (V1 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - buyTaxRate MUST equal sellTaxRate (symmetric rates only).
    ///     - mktBps MUST be 10000 (all tax goes to beneficiary after protocol fee).
    ///     - dividendBps MUST be 0; deflationBps and lpBps MUST be 0.
    ///     - commissionReceiver MUST be address(0) (commission not supported).
    ///     - Dispatched to PortalLauncherV5Tax → creates a FlapTaxToken (TOKEN_TAXED).
    ///
    ///   TOKEN_TAXED_V2 (V2 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - buyTaxRate MUST equal sellTaxRate (symmetric rates only via V5 path).
    ///     - mktBps MUST NOT be 10000 (use TOKEN_TAXED for that case).
    ///     - mktBps + deflationBps + dividendBps + lpBps MUST equal 10000.
    ///     - commissionReceiver MUST be address(0) (commission not supported).
    ///     - Dispatched to PortalLauncherV5Tax → creates a FlapTaxTokenV2 (TOKEN_TAXED_V2).
    ///
    ///   TOKEN_TAXED_V3 (V3 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - Asymmetric rates allowed (buyTaxRate != sellTaxRate is OK).
    ///     - mktBps + deflationBps + dividendBps + lpBps MUST equal 10000.
    ///     - mktBps == 10000 IS allowed (all tax → protocol fee + commission, no marketing).
    ///     - commissionReceiver CAN be non-zero (commission supported).
    ///     - Dispatched to PortalLauncherTaxV3.launchTaxTokenV3 → creates a FlapTaxTokenV3 (TOKEN_TAXED_V3).
    ///
    /// Emits FlapTokenTaxSet (with max rate) AND FlapTokenAsymmetricTaxSet for tax tokens.
    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);

    /// @notice Reserve the token address derived from `salt` by paying SALT_LOCK_FEE.
    /// @dev    The caller must pass the `tokenVersion` they intend to lock for.
    ///         Accepted values: TOKEN_V2_PERMIT (2) for non-tax tokens (NON_TAX_TOKEN_SUFFIX
    ///         vanity requirement, typically 0x8888) and TOKEN_TAXED_V3 (6) for tax tokens
    ///         (TAX_TOKEN_SUFFIX vanity requirement, typically 0x7777).  Any other value
    ///         reverts with UnsupportedTokenVersion.
    ///         Fee is forwarded to FEE_RECEIVER.  Emits FlapSaltLocked.
    /// @param salt         CREATE2 salt to reserve.
    /// @param tokenVersion Token version to lock for. Must be TOKEN_V2_PERMIT or TOKEN_TAXED_V3.
    function lockSalt(bytes32 salt, TokenVersion tokenVersion) external payable;

    /// @notice Launch a new token with V4/PCS Infinity migration support
    /// @param params The V7 token parameters
    /// @return token The created token address
    function newTokenV7(NewTokenV7Params calldata params) external payable returns (address token);
}

/// @title Portal Lens Interface
/// @notice Handles read-only token state queries
interface IPortalLens is IPortalTypes {
    /// @notice Get token state
    /// @param token  The address of the token
    /// @return state  The state of the token
    function getTokenV2(address token) external view returns (TokenStateV2 memory state);
    /// @notice Get token state (V3)
    /// @param token  The address of the token
    /// @return state  The state of the token (V3)
    function getTokenV3(address token) external view returns (TokenStateV3 memory state);
    /// @notice Get token state (V4)
    /// @param token  The address of the token
    /// @return state  The state of the token (V4) with only 'r' curve parameter
    function getTokenV4(address token) external view returns (TokenStateV4 memory state);
    /// @notice Get token state (V5)
    /// @param token  The address of the token
    /// @return state  The state of the token (V5) with all curve parameters (r, h, k)
    function getTokenV5(address token) external view returns (TokenStateV5 memory state);
    /// @notice Get token state (V6)
    /// @param token  The address of the token
    /// @return state  The state of the token (V6) with all V5 fields plus taxRate, pool, and progress
    function getTokenV6(address token) external view returns (TokenStateV6 memory state);
    /// @notice Get token state (V7)
    /// @param token  The address of the token
    /// @return state  The state of the token (V7) with all V6 fields plus lpFeeProfile
    function getTokenV7(address token) external view returns (TokenStateV7 memory state);
    /// @notice Get token state (V8)
    /// @param token  The address of the token
    /// @return state  The state of the token (V8) with asymmetric buyTaxRate and sellTaxRate
    function getTokenV8(address token) external view returns (TokenStateV8 memory state);
    /// @notice Get token state (V8Safe)
    /// @dev Returns enum-typed fields (TokenStatus, TokenVersion, V3LPFeeProfile, DEXId) as uint8
    ///      instead of their Solidity enum types, preventing ABI-decoding reverts when new enum
    ///      variants are introduced. Use this method when you need forward/backward compatibility
    ///      with future contract upgrades that may add new enum values.
    /// @param token  The address of the token
    /// @return state  The state of the token with enum fields encoded as uint8
    function getTokenV8Safe(address token) external view returns (TokenStateV8Safe memory state);
    /// @notice Get the quote token configuration for a given quote token address
    /// @param quoteToken The address of the quote token
    /// @return config The configuration of the quote token
    function getQuoteTokenConfiguration(address quoteToken)
    external
    view
    returns (QuoteTokenConfiguration memory config);
}

interface IPortalLensV2 is IPortalTypes {

    /// @notice Get the salt lock entry for a given CREATE2 salt.
    /// @param salt The CREATE2 salt to query.
    /// @return entry The SaltLockEntry (locker == address(0) means unlocked).
    function getSaltLock(bytes32 salt) external view returns (SaltLockEntry memory entry);

    /// @notice Get the total number of salts locked by a user for a specific token version in the on-chain index.
    /// @dev Only locks made from v5.11.0 onwards are present; pre-upgrade locks are not indexed.
    /// @param user         The address of the user.
    /// @param tokenVersion The TokenVersion (as uint8) to filter on.
    /// @return count The number of salts in the on-chain index for this user and version.
    function getLockedSaltsCountByUserAndVersion(address user, uint8 tokenVersion) external view returns (uint256 count);

    /// @notice Paginated enumeration of salts locked by a user for a specific token version.
    /// @dev Only locks made from v5.11.0 onwards are present; pre-upgrade locks are not indexed.
    ///      `limit` is capped at 100.
    /// @param user         The address of the user.
    /// @param tokenVersion The TokenVersion (as uint8) to filter on.
    /// @param offset       Zero-based start index within the user+version set.
    /// @param limit        Maximum number of entries to return (capped at 100).
    /// @return salts   The salt values in [offset, offset+limit).
    /// @return entries The corresponding SaltLockEntry structs.
    /// @return total   The total number of salts in the on-chain index for this user and version.
    function getLockedSaltsByUserAndVersion(address user, uint8 tokenVersion, uint256 offset, uint256 limit)
    external
    view
    returns (bytes32[] memory salts, SaltLockEntry[] memory entries, uint256 total);
}

/// @title IPortalTrade Interface
/// @notice Handles token trading and redemption
interface IPortalTrade is IPortalTypes {
    /// @notice Buy token with ETH on creation
    /// @param token  The address of the token to buy
    /// @param recipient  The address to send the token to
    /// @param inputAmount The amount of ETH to spend
    ///
    /// @dev  This function is mainly for internal use (be delegated called from the portal contract)
    ///       The msg.value can be greater than inputAmount, the excess ETH will not be
    ///       refunded to the caller. They will be charged as a fee.
    ///
    ///       Note: the slippage is not checked in this function.
    ///
    function buyOnCreation(address token, address recipient, uint256 inputAmount)
    external
    payable
    returns (uint256 amount);

    /// @notice Buy token with ETH
    /// @param token  The address of the token to buy
    /// @param recipient  The address to send the token to
    /// @param minAmount  The minimum amount of tokens to buy
    function buy(address token, address recipient, uint256 minAmount) external payable returns (uint256 amount);

    /// @notice Sell token for ETH
    /// @param token  The address of the token to sell
    /// @param amount The amount of tokens to sell
    /// @param minEth The minimum amount of ETH to receive
    function sell(address token, uint256 amount, uint256 minEth) external returns (uint256 eth);

    /// @notice Redeem a killed token for another token
    /// @param srcToken The address of the token to redeem
    /// @param dstToken The address of the token to receive
    /// @param srcAmount The amount of srcToken to redeem
    /// @return dstAmount The amount of dstToken to receive
    function redeem(address srcToken, address dstToken, uint256 srcAmount) external returns (uint256 dstAmount);

    /// @notice Preview the amount of tokens to buy with ETH
    /// @param token  The address of the token to buy
    /// @param eth  The amount of ETH to spend
    /// @return amount  The amount of tokens to buy
    function previewBuy(address token, uint256 eth) external view returns (uint256 amount);

    /// @notice Preview the amount of ETH to receive for selling tokens
    /// @param token  The address of the token to sell
    /// @param amount  The amount of tokens to sell
    /// @return eth  The amount of ETH to receive
    function previewSell(address token, uint256 amount) external view returns (uint256 eth);

    /// @notice Preview redeem
    /// @param srcToken The address of the token to redeem
    /// @param dstToken The address of the token to receive
    /// @param srcAmount The amount of srcToken to redeem
    /// @return dstAmount The amount of dstToken to receive
    function previewRedeem(address srcToken, address dstToken, uint256 srcAmount)
    external
    view
    returns (uint256 dstAmount);
}

/// @title IPortalTradeV2 Interface
/// @notice Handles unified token swaps and quoting
interface IPortalTradeV2 is IPortalTypes {
    /// @notice Emitted when tax is paid on bonding curve for TAX_TOKEN
    /// @param token The address of the token
    /// @param amount The amount of tax paid
    event TaxOnBondingCurvePaid(address indexed token, uint256 amount);

    /// @notice Emitted when tax is paid on bonding curve for TAX_TOKEN_V2
    /// @param token The address of the token
    /// @param amount The amount of tax paid
    event TaxV2OnBondingCurvePaid(address indexed token, uint256 amount);

    /// @notice Parameters for swapping exact input amount for output token
    struct ExactInputParams {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
        /// @notice The minimum amount of output token to receive
        uint256 minOutputAmount;
        /// @notice Optional permit data for the input token (can be empty)
        bytes permitData;
    }

    /// @notice Parameters for swapping exact input amount for output token (V3) with extension support
    struct ExactInputV3Params {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
        /// @notice The minimum amount of output token to receive
        uint256 minOutputAmount;
        /// @notice Optional permit data for the input token (can be empty)
        bytes permitData;
        /// @notice Additional extension specific data to be passed to the extension's `onTrade` method, check the extension's documentation for details on the expected format and content
        bytes extensionData;
    }

    /// @notice Parameters for quoting the output amount for a given input
    struct QuoteExactInputParams {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
    }
    /// @notice Swap exact input amount for output token
    /// @param params The swap parameters
    /// @return outputAmount The amount of output token received
    /// @dev Here are some possible scenarios:
    ///   If the token's reserve is BNB or ETH (i.e: the quote token is the native gas token):
    ///      - BUY: input token is address(0), output token is the token address
    ///      - SELL: input token is the token address, output token is address(0)
    ///   If the token's reserve is another ERC20 token (eg. USD*, i.e, the quote token is an ERC20 token):
    ///      - BUY with USD*: input token is the USD* address, output token is the token address
    ///      - SELL for USD*: input token is the token address, output token is the USD* address
    ///      - BUY with BNB or ETH: input token is address(0), output token is the token address.
    ///        (Note: this requires an internal swap to convert BNB/ETH to USD*, nativeToQuoteSwap must be anabled for this quote token)
    /// Note: Currently, this method supports trading tokens that is either still on the bonding curve or already listed on DEX.

    function swapExactInput(ExactInputParams calldata params) external payable returns (uint256 outputAmount);

    /// @notice Swap exact input amount for output token (V3) with extension support
    /// @param params The swap parameters including extension data
    /// @return outputAmount The amount of output token received
    /// @dev Similar to swapExactInput but with extension support. Extension hooks will be called if the token uses an extension
    function swapExactInputV3(ExactInputV3Params calldata params) external payable returns (uint256 outputAmount);

    /// @notice Quote the output amount for a given input
    /// @param params The quote parameters
    /// @return outputAmount The quoted output amount
    /// @dev refer to the swapExactInput method for the scenarios
    function quoteExactInput(QuoteExactInputParams calldata params) external returns (uint256 outputAmount);
}

interface IV4Locker {
    /// @notice Collect V4/PCS Infinity LP fees for a token and distribute via TaxProcessor
    /// @dev Can be called by anyone (permissionless keeper). The Locker's collectAddress is
    ///      set to Portal, so fees always flow through Portal → TaxProcessor → distribution.
    /// @param token The token whose LP fees to collect
    function collectV4Fees(address token) external;

    /// @notice Add liquidity to locked V4/PCS Infinity LP positions for a token.
    /// @dev Called by TaxProcessor to reinvest LP-share tax revenue.
    ///      Tokens must be transferred to Portal before calling this function.
    ///      Portal (as lock owner) calls increaseLiquidity on the GoPlus/UNCX locker
    ///      for both the quote-only (lower) and token-only (upper) positions.
    /// @param token        The protocol token address
    /// @param tokenAmount  Amount of protocol token available for LP
    /// @param quoteAmount  Amount of quote token available for LP
    /// @return actualTokenUsed Total protocol token consumed
    /// @return actualQuoteUsed Total quote token consumed
    function addV4LPLiquidity(address token, uint256 tokenAmount, uint256 quoteAmount)
    external
    returns (uint256 actualTokenUsed, uint256 actualQuoteUsed);
}

/// @title IPortalCore Interface
/// @notice Combines IPortalLauncher and IPortalTrade
interface IPortalCore is IPortalLauncher, IPortalTrade, IPortalTradeV2 {}

/// @title IPortalMigrator Interface
/// @notice Add liquidity from the bonding curve to DEX
/// @dev this is not a public interface of the portal.
///      All the functions of this interface are either called from the portal
///      or from the UniswapV3Pool contract.
interface IPortalMigrator {
    /// @notice Add liquidity to DEX
    /// @param token The address of the token
    /// @dev This is an internal function
    ///      Any dispatch to this function should be checked in portal contract
    ///      This function may be dellegated called from a payable function.
    function luanchToDEX(address token) external payable;
}

/// @title IRoller Interface
/// @notice This acts as the glue between the portal and the flap staking contract
interface IRoller {
    /// @notice The lock the token is using
    enum LockType {
        INVALID_LOCK, // Invalid lock
        UNCX_LOCK, // The UNCX lock
        GOPLUS_UNIV3_LOCK, // The Goplus UNIv3 lock
        TOSHI_LP_LOCK, // The Toshi LP lock
        IZI_LP_LOCK // The IziSwap LP locker
    }

    /// @notice get the locks by token address
    /// @param token The address of the token
    /// @return locks The lock ids of the token
    function getLocks(address token) external view returns (uint256[] memory locks);

    /// @dev deprecated
    function rollv2(bytes calldata packedParams) external;

    /// @notice Revenue Share: Claim LP fees for a vanity token
    /// @param token The address of the token
    /// @return tokenAmount The amount of the token claimed
    /// @return ethAmount The amount of ETH claimed
    /// @dev Only the beneficiary of the token can call this function.
    function claim(address token) external returns (uint256 tokenAmount, uint256 ethAmount);

    /// @notice Allows the default admin to change the beneficiary of a token
    /// @param token The address of the token
    /// @param newBeneficiary The new beneficiary address
    function setTokenBeneficiary(address token, address newBeneficiary) external;

    /// @notice Allows a roller or default admin to claim LP fees on behalf of the beneficiary
    /// @param token The address of the token
    /// @return tokenAmount The amount of the token claimed
    /// @return quoteAmount The amount of quote token (or ETH) claimed
    /// @dev Only the roller or default admin can call this function.
    /// The claimed fee will be sent to the beneficiary of the token.
    function delegateClaim(address token) external returns (uint256 tokenAmount, uint256 quoteAmount);
}

interface IPortalDexRouter {
    // @notice Update the DEX pool information for a token
    // @dev can only be called by DEX_ROUTER_MANAGER_ROLE roles
    function updateTokenPoolInfo(address token, IPortalTypes.PackedDexPool calldata poolInfo) external;
}

/// @title IPortalTweak Interface
/// @notice Handles admin-only configuration operations for the Portal
interface IPortalTweak is IPortalTypes {
    /// @notice Parameters for updating tax token addresses
    struct TaxTokenAddressUpdate {
        /// @notice The address of the tax token to update
        address token;
        /// @notice The new beneficiary address for the tax splitter
        address beneficiary;
        /// @notice The new fee receiver address for the tax splitter
        address feeReceiver;
    }

    /// @notice Emitted when tax token addresses are updated
    /// @param token The address of the tax token
    /// @param beneficiary The new beneficiary address
    /// @param feeReceiver The new fee receiver address
    /// @dev Only Default ADMIN can change this
    event TaxTokenAddressesUpdated(address indexed token, address beneficiary, address feeReceiver);

    /// @notice Set the configuration for a quote token
    /// @dev Only callable by the default admin
    /// @param quoteToken The address of the quote token
    /// @param config The configuration struct for the quote token
    function setQuoteTokenConfiguration(address quoteToken, QuoteTokenConfiguration calldata config) external;

    /// @notice Set the fee exemption status for a list of traders
    /// @dev Only callable by the default admin
    /// @param traders The addresses of the traders to set exemption for
    /// @param isExempted Whether the traders should be exempted from fees
    function setFeeExemption(address[] memory traders, bool isExempted) external;

    /// @notice Get the current buy and sell fee rates
    /// @return buyFeeRate The current buy fee rate in basis points (e.g. 200 = 2%)
    /// @return sellFeeRate The current sell fee rate in basis points (e.g. 200 = 2%)
    function getFeeRate() external view returns (uint256 buyFeeRate, uint256 sellFeeRate);

    /// @notice Set the fee profile for a token
    /// @dev Only callable by DEFAULT_ADMIN_ROLE or TOKEN_FLAP_FEE_SETTER_ROLE
    /// @param token The address of the token
    /// @param feeProfile The fee profile to set
    function setFlapFeeProfile(address token, FlapFeeProfile feeProfile) external;

    /// @notice Update beneficiary and feeReceiver addresses for one or more tax tokens
    /// @dev Only callable by the default admin, TAX_MANAGER_ROLE, or TAX_GUARDIAN_ROLE
    /// @param updates Array of TaxTokenAddressUpdate structs containing token addresses and new addresses
    function updateTaxTokenAddresses(TaxTokenAddressUpdate[] calldata updates) external;

    /// @notice Register an extension for use with the portal
    /// @param extensionId The unique identifier for this extension
    /// @param extensionAddress The address of the extension contract
    /// @param version The version of the extension interface it implements (starting from 1)
    /// @dev Only callable by the default admin
    function registerExtension(bytes32 extensionId, address extensionAddress, uint8 version) external;

    /// @notice Block or unblock multiple addresses from creating tokens
    /// @param spammers The addresses to block or unblock
    /// @param blocked True to block, false to unblock
    /// @dev Only callable by the default admin or MODERATOR_ROLE
    function setSpammerBlockedBatch(address[] calldata spammers, bool blocked) external;

    /// @notice Quickly pause only `newTokenV7` while leaving other global-switch entrypoints unaffected.
    /// @dev Callable by V7_GUARDIAN_ROLE or DEFAULT_ADMIN_ROLE.
    function haltNewTokenV7() external;

    /// @notice Emitted when stuck tax tokens are recovered from the tax splitter
    /// @param taxToken The address of the tax token
    /// @param amountSentToToken The amount of tokens sent back to the tax token contract
    /// @param amountReturnedToSplitter The amount of tokens returned to the tax splitter
    event StuckTaxTokenRecovered(address indexed taxToken, uint256 amountSentToToken, uint256 amountReturnedToSplitter);

    /// @notice Recover stuck tax tokens from the tax splitter and re-inject up to liquidationThreshold into the token
    /// @dev Only callable by AUDITOR_ROLE. Currently supports V1 (TOKEN_TAXED) tax tokens.
    ///      The name is intentionally generic to allow extension to V2/V3 tax tokens in the future.
    /// @param taxToken The address of the V1 tax token to recover stuck tokens for
    function recoverStuckTaxToken(address taxToken) external;

    /// @notice Emitted when stuck tax tokens are burned (sent to the dead address)
    /// @param taxToken The address of the tax token
    /// @param amountBurned The amount of tokens sent to the dead address
    event StuckTaxTokenBurned(address indexed taxToken, uint256 amountBurned);

    /// @notice Burn stuck tax tokens by sweeping them from the tax splitter and sending to the dead address
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Supports V1 (TOKEN_TAXED) tax tokens.
    /// @param taxToken The address of the V1 tax token to burn stuck tokens for
    function burnStuckTaxToken(address taxToken) external;

    /// @notice Emitted when marketAddress is updated for a V2/V3 tax token.
    event MarketWalletChanged(address indexed token, address indexed oldMarket, address indexed newMarket);

    /// @notice Changes the market wallet (TaxProcessor.marketAddress) for a TOKEN_TAXED_V2 or TOKEN_TAXED_V3 token.
    /// @dev Restricted to TAX_GUARDIAN_ROLE or DEFAULT_ADMIN_ROLE.
    /// @param token The tax token address.
    /// @param newMarketWallet The new market wallet address.
    function changeMarketWallet(address token, address newMarketWallet) external;
}

/// @title Portal Interface
/// @notice This interface combines the core and game interfaces
interface IPortal is
    IPortalCore,
    IAccessControlUpgradeable,
    IRoller,
    IV4Locker,
    IPortalDexRouter,
    IPortalTweak,
    IPortalLens,
    IPortalLensV2,
    IPortalLauncherTwoStep
{
    /// @notice Get the version of the portal
    /// @return The version string
    function version() external view returns (string memory);

    /// @notice Check if tax on bonding curve is enabled
    /// @return enabled True if tax on bonding curve is enabled
    function enableTaxOnBondingCurve() external view returns (bool enabled);

    /// @notice Change the protocol bit flags
    /// @dev Can only be called with DEFAULT_ADMIN_ROLE
    /// @param flags The new flags
    function setBitFlags(uint256 flags) external;

    /// @notice Can only be called by the guardian role or the default admin role
    /// @dev This function is used to pause the protocol
    function halt() external;

    /// @notice Check if an address is blocked from creating tokens
    /// @param spammer The address to check
    /// @return True if the address is blocked
    function isSpammerBlocked(address spammer) external view returns (bool);

    /// @notice Send a message for a token
    /// @param token The address of the token
    /// @param message The message to send
    function sendMsg(address token, string memory message) external;

    /// @notice Get the current nonce of the portal
    function nonce() external view returns (uint256);
}
```
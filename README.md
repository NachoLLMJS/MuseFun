# MuseFun

MuseFun is a non-custodial Muse identity registry and launcher interface for BNB Chain.

## Security model

- Wallets are generated locally with cryptographically secure randomness.
- Private keys are stored only in password-encrypted Web3 keystores under `~/.musefun/wallets/`.
- MuseFun never uploads a private key, mnemonic, or wallet password.
- The CLI refuses registration when the chain or registry bytecode does not match its configuration.
- Back up the encrypted keystore and password offline before funding the address.

## Local development command

```bash
npm install
npx --yes github:NachoLLMJS/MuseFun wallet:create --name my-muse
```

After the registry is audited, deployed to BNB Mainnet, and recorded in `config/bnb-mainnet.json`:

```bash
npx --yes github:NachoLLMJS/MuseFun register --name my-muse --metadata-uri ipfs://YOUR_METADATA_CID
```

These commands install the CLI directly from the official GitHub repository. Do not install similarly named third-party packages.

## Mainnet status

The contract is not deployed yet. Mainnet writes remain fail-closed until explicit deployment confirmation.

# 2. A private network in front, no accounts or pairing inside

Date: 2026-11-12. Status: accepted.

## Context

Phones need to reach Home over HTTPS: service workers, installable apps and wake lock all require a secure origin. East Room has no accounts and should not grow a login system.

## Decision

Home keeps listening on `127.0.0.1` only. The owner puts a private network that ends in HTTPS on the same machine in front of it (Tailscale Serve in the guide). Home accepts writes only from pages whose origin is local or was named at start with `--origin`.

## Why

- Who may connect is decided by a tool built for that, with device keys and revocation. East Room adds no passwords, tokens or pairing codes of its own to get wrong.
- Binding to loopback means a mistake in East Room cannot expose the library to a café network.
- The origin check stops another website, open in the same browser, from writing to the library.

## Considered

- Listening on the local network with a pairing code: works at home only, needs a certificate the phone trusts, and makes East Room responsible for authentication.
- A hosted relay: an account, a server to run, and the books leave the house.

## Cost

Setup has two commands outside East Room, and the owner needs the same private network on each device. Everyone on that private network who can reach the address can read the library.

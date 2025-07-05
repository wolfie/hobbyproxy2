# HobbyProxy v2

This project is a naïve implementation of a reverse proxy for serving various projects within your homelab.

## Startup

Clone the entire git project:

```bash
git clone --depth 1 https://github.com/wolfie/hobbyproxy2.git
```

To later update the repository, you can use the commands

```bash
git fetch --depth 1 origin master && git reset --hard origin/master && pnpm i --prod
```


HobbyProxy assumes Node 24 or newer. The easiest way to ensure a supported version is with [nvm](https://github.com/nvm-sh/nvm#readme), and running the following command in the project directory:

```bash
cd hobbyproxy2
nvm install
corepack enable
pnpm i --prod
```

To start the proxy, run this in the HobbyProxy directory:

```bash
pnpm start
```

You can alternatively also use the following CLI option:

- `--startup-challenge <action>`: What to do with the DNS-verification step at startup?
  - `error`: _(default)_ Refuse to start the server if the DNS does not resolve to this server.
  - `ignore`: Check whether the DNS resolves to this server, write warnings about possible failures and keep the server running.
  - `skip`: Skip this verification step altogether.

## Environment Variables

You can give the following env vars to HobbyProxy

- CLOUDFLARE_API_TOKEN _required_
  - Create one at https://dash.cloudflare.com/profile/api-tokens. Make sure it has DNS management access in your chosen Zone
- CLOUDFLARE_ZONE_ID _required_ 
  - Log in to Cloudflare, select a domain, right hand side, under the topics "API" and "Zone ID" is a 32-character hex string
- DOMAIN_NAME _required_
  - If you want to proxy for the domains `example.com` and the wildcard domain `*.example.com`, use the value "`example.com`"
- EMAIL _required_
  - Used only as the contact information for Let's Encrypt certificate application.
- LETSENCRYPT_TOS_AGREED _required_
  - Give `true` if you agree to the [Let's Encrypt TOS](https://letsencrypt.org/repository/#let-s-encrypt-subscriber-agreement)
- HTTP_PORT _default=8080_
- HTTPS_PORT _default=8433_
- NTFY_SERVER _default=https://ntfy.sh_
- NTFY_TOPIC _optional_

## Logging

HobbyProxy supports [ntfy.sh](https://ntfy.sh/) notifications. Unless `NTFY_TOPIC` is explicitly given, ntfy.sh messages are disabled. The free tier is plenty enough, as notifications are collated into larger chunks (rather than sent line-by-line). Pick a unique `NTFY_TOPIC` (try e.g. `hobbyproxy` followed by [two random words](https://duckduckgo.com/?q=generate%20passphrase) )

However, if you want more secrecy, you can also set up your own server

## Admin API

The Admin API is available from the [local network address space](https://datatracker.ietf.org/doc/html/rfc1918#section-3) or from the localhost. It has two endpoints:

- `GET /` will return a JSON body of all current routes
- `POST /` allows you to add and/or update routes, using the `PostBody` structure
- `DELETE /` allows you to remove routes, using the `DeleteBody` structure

### PostBody Structure

You can create either:
* a HTTP route, that will proxy the queries to another service, or
* a ZIP route, that will extract a ZIP archive into memory, and serve it as static resources. (You can also use the Admin UI to add ZIP routes)

All fields are required, even the `"version": 3` (it must be the number 3).

#### HTTP Route
```json
{
    "version": 3,
    "type": "http",
    "hostname": "subdomain.yourdomain.tld",
    "target": {
        "hostname": "10.0.0.1",
        "port": 8080,
    },
    "expires": "2026-01-01T12:00:00.000Z"
}
```

#### ZIP Route

```json
{
    "version": 3,
    "type": "zip",
    "hostname": "subdomain.yourdomain.tld",
    "filename": "unique-archive-name.zip",
    "contents": "base64formattedstring/"
}
```

### DeleteBody Structure

```json
{
  "hostname": "subdomain.yourdomain.tld"
}
```

## Admin UI

The Admin UI is available from [local network address space](https://datatracker.ietf.org/doc/html/rfc1918#section-3) or from the localhost. It is in the url `/ui` (e.g. http://localhost:8080/ui) with any browser. It allows you to see the current routes, remove routes and upload any static routes as [ZIP archives](https://en.wikipedia.org/wiki/ZIP_(file_format)).

## Startup Flow

1. Load the SSL certificate for your domain, e.g. "domain.tld" and "\*.domain.tld"
   1. Try to find existing ones from disk, or
   2. Try to get a new one from [Let's Encrypt](https://letsencrypt.org/):
      1. Create an [ACME](https://en.wikipedia.org/wiki/Automatic_Certificate_Management_Environment) client:
         1. Try to load client private key from disk, or
         2. Create a new private key
      2. Prepare a [DNS-01](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge) challenge
         1. Create necessary DNS TXT records for the DNS challenge as requested
         2. Clean up the DNS TXT records afterwards
2. Start up both HTTP and HTTP2 servers
3. Verify that domain is set up correcly:
   1. Check DNS records:
      1. Both root and wildcard records present?
      2. Add the missing records
      3. Update the records pointing to a different IP
   2. Query "domain.tld" and "&lt;random&gt;.domain.tld" with a challenge under the path `/.well-known/hobbyproxy/<UUID>`

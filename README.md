# HobbyProxy v2

This project is a naíve implementation of a reverse proxy for serving various projects within your homelab.

## Startup

Clone the entire git project:

```bash
git clone --depth 1 https://github.com/wolfie/hobbyproxy2.git
```

HobbyProxy assumes Node 24 or newer. The easiest way to ensure a supported version is with [nvm](https://github.com/nvm-sh/nvm#readme), and running the following command in the project directory:

```bash
cd hobbyproxy2
nvm install
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

## Admin API

The Admin API is available from the [local network address space](https://datatracker.ietf.org/doc/html/rfc1918#section-3) or from the localhost. It has two endpoints:

- `GET /` will return a JSON body of all current routes
- `POST /` allows you to add and/or update routes, using the `PostBody` structure
- `DELETE /` allows you to remove routes, using the `DeleteBody` structure

### PostBody Structure

```json
{
  "version": 2,
  "hostname": "subdomain.yourdomain.tld",
  "target": {
    "hostname": "10.0.0.1",
    "port": 8080
  },
  "expires": "2026-01-01T12:00:00.000Z"
}
```

All fields are required, even the `"version": 2` (it must be the number 2).

### DeleteBody Structure

```json
{
  "hostname": "subdomain.yourdomain.tld"
}
```

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

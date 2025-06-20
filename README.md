# HobbyProxy v2

This project is a naíve implementation of a reverse proxy for serving various projects within your homelab.

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
      2. **TODO:** Are they pointing to our current IP?
      3. Add the missing records
   2. **TODO:** Query "domain.tld" and "&lt;random&gt;.domain.tld" with a challenge

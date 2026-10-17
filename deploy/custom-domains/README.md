# Custom domains

A master's own domain (set on the Platform screen) is put live by
`bb-custom-domains`, a host job every two minutes:

1. **The domain's DNS** has to point at the server: an `A` record for the domain
   (and for `www.` if wanted) to the server's public IP. Until it does, the
   Platform screen shows *waiting for DNS*.
2. The job then writes a port-80 server block so Let's Encrypt can reach the
   challenge, gets a certificate with certbot (`--cert-name bb-<domain>`), and
   adds the HTTPS block — *active*. Links to the master's page switch to the
   domain from then on.
3. A domain removed from its master has its server block taken down.

It only ever writes `bb-domain-<domain>.conf` in the nginx config folder. A
domain another site on the server already serves is left alone — *conflict*.
A certificate that can't be issued is *failed* and retried after 5 min, 10, 20 …
up to 6 hours (Let's Encrypt limits failed validations). If `nginx -t` fails,
that run's changes are undone. If the database can't be read, nothing is
touched.

Certificates renew with the server's certbot timer; the existing deploy hook
reloads nginx.

## Install / update

```bash
ssh oracle-server 'sudo bash /opt/beautybook/repo/deploy/custom-domains/install.sh <server public ip>'
```

Logs: `journalctl -u bb-custom-domains`.

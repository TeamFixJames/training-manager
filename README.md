# Training Manager - Authenticated App Starter

This branch converts the Training Manager prototype into a Next.js application protected by Auth0.

## First milestone
- Auth0 login/logout
- Protected `/training-manager` route
- Display authenticated manager name/email
- Existing dashboard loaded unchanged inside the authenticated shell

## Important
Never commit real Auth0 secrets to GitHub. They belong in the hosting provider's environment-variable settings.

## Required environment variables
- AUTH0_DOMAIN
- AUTH0_CLIENT_ID
- AUTH0_CLIENT_SECRET
- AUTH0_SECRET
- APP_BASE_URL

The existing dashboard is preserved at `public/dashboard.html`.

# PodPilot Product Context

## Product Name

PodPilot

## Product Purpose

PodPilot is a SaaS product for print-on-demand upload automation. It helps sellers prepare, organize, and upload product designs across marketplace platforms with less manual work.

## Main Platforms

- Redbubble: supported upload automation platform
- TeePublic: supported upload automation platform

PodPilot currently focuses on Redbubble and TeePublic upload automation.

## Future or Optional Platforms

- Amazon Merch: future/optional, not active yet

## Core Workflow

Users upload Excel metadata and design image files into PodPilot. The dashboard helps them manage imports, matched images, upload queues, upload status, and subscription limits.

The browser extension performs marketplace uploads through the user's browser session.

## Technical Stack

- Frontend: React + Vite
- Backend: FastAPI
- Auth: Supabase
- Payments and subscriptions: Paddle
- Marketplace automation: browser extension

## Important Product Rules

Do not break upload logic, auth logic, Paddle logic, Supabase logic, or database schema. Redbubble and TeePublic are both active supported automation flows in the current product. Do not describe TeePublic as future or upcoming. Any changes should preserve existing login, signup, dashboard, profile dropdown, subscription, webhook, upload queue, and extension behavior unless a specific bug is being fixed.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WeChat Mini Program (微信小程序) named "小嘟干饭" (cook-helper). Cloud development environment: `cloud1-d2gr067wp3692f858`.

## Build & Development

No CLI build/test/lint scripts. All compilation via **WeChat Developer Tools (微信开发者工具)**:

- **TypeScript:** `typescript` compiler plugin in `project.config.json`
- **SCSS:** `sass` compiler plugin in `project.config.json`
- Install type deps: `npm install`
- Open in WeChat DevTools to build, preview, and upload

## Architecture

**Source root:** `miniprogram/` (`miniprogramRoot` in `project.config.json`)

**Tech stack:** TypeScript (strict) + SCSS + Skyline renderer + glass-easel framework + TDesign MiniProgram

**Page pattern:** Every page uses `Component()` constructor (not `Page()`). 4 files per page: `.ts`, `.wxml`, `.scss`, `.json`.

**UI components:** TDesign MiniProgram (`tdesign-miniprogram`). Register per-page in `.json`:
```json
{ "usingComponents": { "t-button": "tdesign-miniprogram/button/button" } }
```

**Navigation:** Custom `navigation-bar` component (`components/navigation-bar/`), all pages use `"navigationStyle": "custom"` in `.json` config.

**Cloud functions** (`cloudfunctions/`):
- `login` — returns `{ openid }` via `cloud.getWXContext().OPENID`
- `dishOp` — generic CRUD (`add`/`update`/`remove`). Auto-injects `_openid`, `createdBy`, `createdAt` on add. Ownership check on update/remove.
- `groupOp` — group management (`leave`/`delete`). Creator cannot leave.
- `getMemberInfos` — batch query user info by openids
- `userSetting` — get/set user settings (`reminderEnabled` in `userSettings` collection). Auto-creates collection if missing.
- `sendDailyReminder` — timer trigger (0:00 daily), sends one-time subscription messages for plans with `reminderEnabled: true`, resets flag after send.

**Database collections** (cloud):
- `users` — user records, `_openid` is the system field
- `groups` — meal groups, has `memberIds`/`members` arrays, `createdBy`
- `dishes` — dish records with `groupId`, `categoryId`, `name`, `rating`, `address`, `note`, `images[]`
- `categories` — hierarchical: `level` 1 (L1) or 2 (L2), `parentId` links L2 to L1
- `plans` — meal plans: `groupId`, `date`, `dishId`, `mealType`, `partnerIds[]`, `reminderEnabled`
- `userSettings` — per-user settings: `reminderEnabled` boolean

## Key Patterns

**Cross-page sync:** Use `wx.setStorageSync('needsRefresh', true)` before navigating back. Check in `pageLifetimes.show()` and refresh if needed.

**Cloud function CRUD:** Use `dishOp` for all dish/category CRUD. Data shape: `{ action, collection, id?, data? }`. `createdBy` is auto-injected.

**Subscription messages:** One-time WeChat subscription — user authorizes per-use. Calendar page has per-dish bell icon, only visible for tomorrow's dishes. Cloud function resets `reminderEnabled: false` after push.

**Type definitions:** `typings/` — `IAppOption` (global data shape) + vendored WeChat API types from `miniprogram-api-typings`.

## Key Constraints

- AppID: `wx53f3ac8fa9e19ad0`
- WeChat lib version: 2.32.3
- Skyline renderer enabled — `Component()` only, no `Page()`
- Indentation: 2 spaces
- tsconfig strict mode (strictNullChecks, noUnusedLocals, noUnusedParameters, etc.)
- `db.collection().where().update()` returns `{ stats: { updated: N } }`, does NOT throw on 0 matches — check `stats.updated` instead of catching errors
- Cloud functions do NOT auto-set `_openid` on `add()` — must pass it explicitly

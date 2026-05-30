#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const pagePath = optionValue(process.argv, "--page", "index.html");
const licenseDirectory = optionValue(
  process.argv,
  "--license-directory",
  "sunvox_lib/sunvox_lib/docs/license",
);
const linkPrefix = optionValue(process.argv, "--link-prefix", licenseDirectory);
const sunvoxLicensePath = join(licenseDirectory, "LICENSE.txt");

function normalizeText(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function decodeBasicHtmlEntities(text) {
  return text
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const requiredPath of [pagePath, sunvoxLicensePath]) {
  if (!existsSync(requiredPath)) {
    fail(`Missing required license check input: ${requiredPath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

const page = readFileSync(pagePath, "utf8");
const normalizedPage = normalizeText(decodeBasicHtmlEntities(page.replace(/<[^>]*>/gu, " ")));
const sunvoxLicense = readFileSync(sunvoxLicensePath, "utf8");
const noticeMatch = /REQUIREMENT 1:\s*([\s\S]*?)\s*REQUIREMENT 2:/u.exec(sunvoxLicense);

if (!noticeMatch) {
  fail(`Could not find SunVox required notice in ${sunvoxLicensePath}`);
} else {
  const noticeLines = noticeMatch[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstNoticeLine = noticeLines.findIndex((line) => line.startsWith("Powered by SunVox"));
  const requiredNotice = firstNoticeLine >= 0 ? noticeLines.slice(firstNoticeLine).join(" ") : "";

  if (!requiredNotice || !normalizedPage.includes(normalizeText(requiredNotice))) {
    fail(`${pagePath} does not include the SunVox required notice from ${sunvoxLicensePath}`);
  }
}

const licenseFiles = readdirSync(licenseDirectory)
  .filter((entry) => entry.toLowerCase().endsWith(".txt"))
  .sort((a, b) => a.localeCompare(b, "en"));

for (const licenseFile of licenseFiles) {
  const linkPath = `${linkPrefix}/${licenseFile}`;
  if (!page.includes(linkPath)) {
    fail(`${pagePath} does not link to ${linkPath}`);
  }
}

if (!process.exitCode) {
  console.log(`License notice check passed for ${pagePath} and ${licenseFiles.length} license files.`);
}

"use client";
import React, { useState } from "react";
import { saveAs } from "file-saver";

// ---------------------------------------------------------------------------
// "Daily Plan – All Plants" mailing list.
//
// Copied verbatim from the Email tab of the Embellishment development plan
// workbook — the "Daily Plan All Plants" block (TO = column 44, CC = column 45).
// Duplicates were removed (case-insensitive) and "Name <addr>" forms reduced to
// the bare address. When that sheet changes, update these two arrays here — this
// is the only place the list lives.
// ---------------------------------------------------------------------------
const DAILY_PLAN_TO: string[] = [
  "imeshm@antlergroup.com",
  "shareef@screenlineholdings.com",
  "ravindrap@antlergroup.com",
  "yangani.c@expo.lk",
  "sanjeewa.p@expo.lk",
  "thilini@leemaembroidery.com",
  "anushka@leemaembroidery.com",
  "inoka@mrc.lk",
  "sandun@mrc.lk",
  "rushanthi@tharinduprinters.lk",
  "ashenu@regalimageint.com",
  "PiyalR@brandix.com",
  "dilan@mrc.lk",
  "shashinif@regalimageint.com",
  "shashini@deshikaemb.com",
  "Sanjaya.Jayadewa@hirdaramani.com",
  "dannang@brandix.com",
  "uvindu.m@expo.lk",
  "sumithma@brandix.com",
  "eranga.jayamini@hirdaramani.com",
  "himaya.p@expo.lk",
  "KasunSam@brandix.com",
  "sasikar@dynawashlimited.com",
  "janakaam@brandix.com",
  "abirajaramrandhi@gmail.com",
  "nimeshm@richcolourexports.com",
  "kavishid@antlergroup.com",
  "heshan@mrc.lk",
  "madawal@antlergroup.com",
  "iroshimas@antlergroup.com",
  "nirmania@antlergroup.com",
  "chalanir@richcolourexports.com",
  "ovinih@antlergroup.com",
  "dilrukshi.biyagamage@hirdaramani.com",
  "kusall@antlergroup.com",
  "pradeepk@bondscreenlk.com",
  "AkilaSat@brandix.com",
  "chathushani.k@expo.lk",
  "shakthi@screenlineholdings.com",
  "piyumal@richcolourexports.com",
  "nisansala@richcolourexports.com",
  "avishkam@regalimageint.com",
  "Dulanjaly.Kannan@hirdaramani.com",
  "kavindu@screenlineholdings.com",
  "dulanjaly@mrc.lk",
  "saumya@tharinduprinters.lk",
  "dineth@screenlineholdings.com",
  "JayanthaKu@brandix.com",
  "BhagyaThi@brandix.com",
  "GayashiGa@brandix.com",
  "IndikaK@brandix.com",
  "PrabathRathn@brandix.com",
  "roshelv@brandix.com",
  "dilnin@brandix.com",
  "anjanadi@brandix.com",
  "ashan@mrc.lk",
  "dinesh@mrc.lk",
  "Krishan.Pradeep@hirdaramani.com",
  "dhammikap@brandix.com",
  "JoySa@brandix.com",
  "UthulaR@fusionapparelhub.com",
  "AdithyaM@Fusionapparelhub.com",
  "SonalPe@brandix.com",
  "ChandimaG@brandix.com",
  "dilini.d@expo.lk",
  "asela@leemaembroidery.com",
  "pathum@christyleema.com",
  "somasiri@leemaembroidery.com",
  "sachini@christyleema.com",
  "grace@christyleema.com",
  "Ayona.Ranasinghe@hirdaramani.com",
];

const DAILY_PLAN_CC: string[] = [
  "NipunaF@brandix.com",
  "DiniduA@brandix.com",
  "GihanU@brandix.com",
  "SudheeraK@brandix.com",
  "kavishkaj@brandix.com",
  "sahanpe@brandix.com",
  "KrishanthaJa@brandix.com",
  "tharushiwi@brandix.com",
  "roshellep@brandix.com",
  "YoshithaC@brandix.com",
  "rashmij@brandix.com",
  "roshelv@brandix.com",
];

// The address the email should be sent FROM. Outlook matches this to a configured
// account in the profile and opens the draft already using that account — so the
// planner never has to touch the "From" dropdown (switching accounts after the
// fact makes Outlook drop every recipient). Must be an account the signed-in user
// actually has send rights on. Change this if the sending mailbox changes.
const SEND_FROM = "DannanG@brandix.com";

// Build an RFC-822 .eml. The `X-Unsent: 1` header is what makes Outlook (and
// Windows Mail) open the file straight into a NEW, editable message window with
// the recipients already filled in — Subject and body are left blank for the
// planner to type. A .eml is used instead of a `mailto:` link because a mailto
// with ~80 recipients blows past the length Outlook's protocol handler accepts
// and silently drops addresses.
function buildEml(to: string[], cc: string[]): string {
  // RFC-5322 header folding: CRLF + a space keeps each address line short.
  const fold = (addrs: string[]) => addrs.join(",\r\n ");
  return (
    [
      `From: ${SEND_FROM}`,
      `To: ${fold(to)}`,
      `Cc: ${fold(cc)}`,
      "Subject: ",
      "X-Unsent: 1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "",
    ].join("\r\n")
  );
}

export default function DailyPlanMailButton() {
  const [downloaded, setDownloaded] = useState(false);

  const handleClick = () => {
    const eml = buildEml(DAILY_PLAN_TO, DAILY_PLAN_CC);
    saveAs(
      new Blob([eml], { type: "message/rfc822" }),
      "Daily Plan - All Plants.eml",
    );
    setDownloaded(true);
    window.setTimeout(() => setDownloaded(false), 5000);
  };

  return (
    <button
      suppressHydrationWarning
      onClick={handleClick}
      title={
        downloaded
          ? "Downloaded — open the .eml file to launch Outlook, then type your subject & message."
          : `Creates one Outlook email addressed to ${DAILY_PLAN_TO.length} plant contacts (To) and ${DAILY_PLAN_CC.length} CC. Type your own subject and message, then send.`
      }
      className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/60 hover:text-blue-500 transition-all whitespace-nowrap"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      {downloaded ? "Open the .eml file…" : "Daily Plan Email"}
    </button>
  );
}

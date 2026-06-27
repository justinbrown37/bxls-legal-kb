import React, { useState, useMemo, useEffect, useRef } from "react";
import { storage } from "./storage";
import { BUNDLED_KB, KB_META } from "./kb";

/*
  BxLS Pleading Drafter — v3
  --------------------------
  Tenant-defense pleading drafting assistant for Bronx Housing Court summary
  proceedings (nonpayment + holdover). Built for Bronx Legal Services.
  Attorney-in-the-loop: every output is a DRAFT requiring independent legal
  judgment, verification, and Shepardizing before filing.

  Standalone web app (v3.x):
   - Runs as a deployable website (Vite + React), no longer dependent on the
     Claude.ai Artifact runtime. The Anthropic API key and optional notes are
     kept in the browser via src/storage.js (localStorage).
   - SINGLE SOURCE OF TRUTH for the knowledge base: legal_kb.json (repo root) is
     bundled in via src/kb.js and pulled into every draft automatically. Add or
     change cases there and push — the deploy rebuilds and the live app updates.
     The drafter may rely on and cite anything in that knowledge base in
     addition to the curated CITES library, while still being forbidden from
     inventing authority that appears in neither source. The Knowledge Base
     panel's text box is now optional matter-specific notes layered on top.

  Carried over from v2:
   - Document intake: upload text PDFs (lease, ledger, HPD, DHCR, ACRIS, etc.).
   - Auto-extraction (Opus 4.8) reads each document and populates the intake form.
   - HSTPA 2019 guardrails: 14-day rent demand enforced; no 3-day demand.

  Drafting is constrained to a curated citation library PLUS the attorney's own
  verified knowledge base; the model is instructed never to invent citations.
  NYSCEF scraping is prohibited (UCS Terms of Use); documents are uploaded by
  counsel and read only at intake.
*/

const MODEL = "claude-opus-4-8";

// ---------------------------------------------------------------------------
// CURATED CITATION LIBRARY
// Every authority the engine is allowed to cite from the built-in library.
// (The attorney's pasted knowledge base is an ADDITIONAL allowed source.)
// Keep this versioned/Shepardized.
// ---------------------------------------------------------------------------
const CITES = {
  chinatown: "Chinatown Apts., Inc. v. Chu Cho Lam, 51 N.Y.2d 786 (1980)",
  hughes: "Hughes v. Lenox Hill Hosp., 226 A.D.2d 4 (1st Dept 1996)",
  oxford: "Oxford Towers Co., LLC v. Leites, 41 A.D.3d 144 (1st Dept 2007)",
  ellivkroy: "Ellivkroy Realty Corp. v. HDP 86 Sponsor Corp., 162 A.D.2d 238 (1st Dept 1990)",
  treanor: "1123 Realty LLC v. Treanor, 62 Misc. 3d 326 (Civ. Ct., Kings County 2018)",
  dendy: "Dendy v. McAlpine, 27 Misc. 3d 138(A) (App. Term, 2d Dept 2010)",
  schwartz: "Schwartz v. Weiss-Newell, 87 Misc. 2d 558 (Civ. Ct., N.Y. County 1976)",
  severine: "EOM 106-15 217th Corp. v. Severine, 62 Misc. 3d 141(A) (App. Term, 2d Dept 2019)",
  pantigo: "Pantigo Professional Ctr., LLC v. Stankevich, 60 Misc. 3d 133(A) (App. Term, 2d Dept 2018)",
  arthur: "2110 Arthur Owners LLC v. Reyes, 34 Misc. 3d 1208(A) (Civ. Ct., Bronx County 2011)",
  jdm: "JDM Washington St., LLC v. 90 Washington Rest. Assoc., LLC, 36 Misc. 3d 769 (Civ. Ct., N.Y. County 2012)",
  parkwest: "Park West Mgmt. Corp. v. Mitchell, 47 N.Y.2d 316 (1979)",
  solow: "Solow v. Wellner, 86 N.Y.2d 582 (1995)",
  bracero: "OLR, MM, LP v. Bracero, 43 Misc. 3d 1215(A) (Civ. Ct., Bronx County 2014)",
  deabreu: "OLR ECW, L.P. v. De Abreu, 59 Misc. 3d 1204(A) (Civ. Ct., Bronx County 2018)",
  brown: "NSA 2015 Owner LLC v. Brown, 2019 N.Y. Slip Op. 51499(U) (Civ. Ct., Bronx County 2019)",
  soto: "OLR ECW, L.P. v. Soto, Index No. 42158/15 (Civ. Ct., Bronx County 2016)",
  dejesus: "Grand Concourse E. HDFC v. DeJesus, 61 Misc. 3d 403 (Civ. Ct., Bronx County 2018)",
  revrul: "Rev. Rul. 2004-82, 2004-35 I.R.B. 350",
  farkas: "New York Univ. v. Farkas, 121 Misc. 2d 643 (Civ. Ct., N.Y. County 1983)",
  ledet: "Georgetown Unsold Shares, LLC v. Ledet, 130 A.D.3d 99 (2d Dept 2015)",
  lonray: "Matter of Lonray, Inc. v. Newhouse, 229 A.D.2d 440 (2d Dept 1996)",
  hartsdale: "Hartsdale Realty Co. v. Santos, 170 A.D.2d 260 (1st Dept 1991)",
  khan: "Dino Realty Corp. v. Khan, 46 Misc. 3d 71 (App. Term, 2d Dept 2014)",
  regina: "Matter of Regina Metro. Co. v. DHCR, 35 N.Y.3d 332 (2020)",
  fieldbridge: "Fieldbridge Assoc. LLC v. Rivers, 2024 N.Y. Slip Op. 50517(U)",
  westpierre: "West Pierre Assoc. LLC v. Harvey, 2025 N.Y. Slip Op. 04611 (1st Dept 2025)",
  chazon: "Chazon, LLC v. Maugenest, 19 N.Y.3d 410 (2012)",
  smalls: "E. Harlem MEC Parcel C, L.P. v. Smalls, 82 Misc. 3d 127(A) (App. Term, 1st Dept 2024)",
  mautnerglick: "Mautner-Glick Corp. v. Higgins, 64 Misc. 3d 16 (App. Term, 1st Dept 2019)",
  leon: "Leon v. Martinez, 84 N.Y.2d 83 (1994)",
  // Statutes / regs
  hstpa: "Housing Stability and Tenant Protection Act of 2019, L. 2019, c. 36",
  mdl301: "Multiple Dwelling Law § 301",
  mdl302: "Multiple Dwelling Law § 302",
  nycrr20842: "22 NYCRR § 208.42(b)",
  ao16319: "Administrative Order AO/163/19 (mandatory Notice of Petition form)",
  rpapl711: "RPAPL § 711(2)",
  rpapl702: "RPAPL § 702",
  rpapl741: "RPAPL § 741",
  rpapl743: "RPAPL § 743",
  rpl235b: "Real Property Law § 235-b",
  rpl235e: "Real Property Law § 235-e(d)",
  rpl234: "Real Property Law § 234",
  rpl238a: "Real Property Law § 238-a",
  rsc25243: "Rent Stabilization Code (9 NYCRR) § 2524.3",
  rsc25242: "Rent Stabilization Code (9 NYCRR) § 2524.2",
  rsl26517: "Rent Stabilization Law (Admin. Code) § 26-517(e)",
  rsc25284: "Rent Stabilization Code (9 NYCRR) § 2528.4",
  cca110: "N.Y.C. Civil Court Act § 110",
  cplr3211: "CPLR § 3211(a)(7)",
  cplr3212: "CPLR § 3212",
  cplr3018: "CPLR § 3018(b)",
  cplr3019: "CPLR § 3019",
  cplr3025: "CPLR § 3025(b)",
  cplr408: "CPLR § 408",
  cplr409: "CPLR § 409(b)",
  cplr3020: "CPLR §§ 3020, 3021",
  cfr982310: "24 C.F.R. § 982.310",
  irc42: "26 U.S.C. § 42(h)(6)(B)(i)",
  irc42g8: "26 U.S.C. § 42(g)(8)(B) (HERA 2008)",
  cfr1425: "26 C.F.R. § 1.42-5(b)(1)(vii)",
  mdl302a: "Multiple Dwelling Law § 302-a",
  hmc: "NYC Housing Maintenance Code (Admin. Code Tit. 27, ch. 2 / Tit. 28)",
  rule2028b: "22 NYCRR § 202.8-b",
};

// ---------------------------------------------------------------------------
// DOCUMENT SLOTS + EXTRACTION GUIDANCE
// ---------------------------------------------------------------------------
const DOC_SLOTS = [
  { id: "petition", label: "Petition / Notice of Petition" },
  { id: "predicateNotice", label: "Predicate Notice (Demand / Termination)" },
  { id: "lease", label: "Lease / Rider" },
  { id: "rentLedger", label: "Rent Ledger" },
  { id: "hpdReg", label: "HPD Registration" },
  { id: "hpdViol", label: "HPD Violations" },
  { id: "dobEcb", label: "DOB / ECB Violations" },
  { id: "coIcard", label: "Cert. of Occupancy / I-Card" },
  { id: "dhcr", label: "DHCR Rent History / Records" },
  { id: "section8", label: "Section 8 / NYCHA Share History" },
  { id: "acris", label: "ACRIS Deed / Regulatory Agreement" },
  { id: "hra", label: "HRA Records" },
  { id: "dos", label: "NYS Dept. of State Corp. Registration" },
  { id: "priorCases", label: "Prior Cases Between the Parties" },
];

const DOC_GUIDANCE = {
  petition: `This is the notice of petition and petition. Extract: petitioner (landlord) name exactly; respondent (tenant) name(s); premises (full apartment address); index number; Housing Part; the total amount the petition demands (petitionAmount); the number of separately numbered paragraphs in the petition (petitionParagraphs, as a number); and whether this is a NONPAYMENT or HOLDOVER proceeding (proceedingTypeSuggestion). If the notice of petition plainly does not conform to the mandatory court form prescribed by 22 NYCRR § 208.42(b) / AO 163/19 (for example, a self-drafted or outdated notice of petition lacking the prescribed form language), set wrongNopForm=true and note what is missing in findings; if you cannot tell from the document, leave wrongNopForm null.`,
  predicateNotice: `This is the predicate notice. If it is a RENT DEMAND (nonpayment), extract the total amount demanded (demandAmount) and set demandIncludesFees=true if it lumps in late fees, legal fees, or "additional rent." Note in findings whether it is properly framed as a 14-day demand and whether the periods demanded postdate the notice. If it is a NOTICE TO CURE / TERMINATION (holdover), set noticeNoLeaseProvision=true if it fails to identify the specific lease provision violated; noticeVague=true if it lacks the dates/facts needed to frame a defense; noticeDateConflict=true if cure/termination dates are inconsistent or impossible; groundRecert=true if the ground is failure to recertify income (LIHTC/subsidy).`,
  lease: `This is the residential lease and any riders. Extract respondent/tenant name(s) and premises. Set leaseHasFees=true if there is an attorneys'-fees clause. Set rentStabilized=true if there is a rent-stabilization rider. Set lihtc=true if there is a LIHTC/Section 42 or Tax Credit rider; if a rider expressly REQUIRES annual income recertification, note that in findings and set groundRecert=true only if the case is a holdover premised on failure to recertify. Set section8=true for Section 8/HAP language; set mitchellLama=true for Mitchell-Lama language. Do NOT infer petitionAmount from the lease base rent.`,
  rentLedger: `This is the landlord's rent ledger. Extract the current running balance / total arrears (ledgerAmount). Set demandIncludesFees=true if the ledger includes late fees, legal fees, or "additional rent" charges mixed into the balance. Set staleRent=true if a substantial portion of the arrears is old (e.g., more than ~6 months stale) such that laches may apply. In findings, note the last payment date and any pattern of misapplied payments.`,
  hpdReg: `This is the HPD multiple-dwelling registration. Confirm the registered owner/managing agent (compare to petitioner) and premises in findings. Note whether the registration appears valid and current; a missing or invalid HPD registration can bar rent recovery (MDL § 302-a) — flag that in findings.`,
  hpdViol: `These are HPD violations. If there are open Class B (hazardous) or Class C (immediately hazardous) violations, set habitability=true and summarize the conditions and their classes into habitabilityConditions. Note dates and whether violations are open/certified-corrected in findings.`,
  dobEcb: `These are DOB / ECB violations. If any open violation reflects conditions dangerous or detrimental to health/safety in the unit or building, set habitability=true and add a brief description to habitabilityConditions. Otherwise summarize in findings.`,
  coIcard: `This is the Certificate of Occupancy or I-card. Determine the legal use and number of legal dwelling units. If there is no valid certificate of occupancy for the building, or the subject apartment is not a legal dwelling unit, or a unit was created/altered (e.g., subdivided) without an updated C of O, or the building is occupied beyond its legal C of O, set noValidCofO=true and explain the basis in findings (this bars recovery of rent under MDL §§ 301-302). If the C of O is valid and current, leave noValidCofO null.`,
  dhcr: `This is DHCR rent history / records. Set rentStabilized=true if the unit is registered as rent-stabilized. Set notRegistered=true if there are gaps or missing annual registrations (registration freeze). Set overchargeSuspected=true if the registered/collected rent shows increases inconsistent with the legal regulated rent or a suspicious jump. Summarize the registration timeline in findings.`,
  section8: `These are Section 8 / NYCHA records. Set section8=true. In findings, state the tenant share vs. the HAP (subsidy) share and the payment history; if the arrears appear to include the HAP/subsidy portion, note that the demand improperly seeks the subsidy share (the tenant is not liable for it). Note voucher status.`,
  acris: `This is an ACRIS deed and/or recorded regulatory agreement. Set lihtc=true if there is a recorded LIHTC/extended low-income housing regulatory agreement; set mitchellLama=true for a Mitchell-Lama regulatory agreement. In findings, identify the record owner (compare to petitioner for standing/capacity) and any recorded use restriction or good-cause covenant.`,
  hra: `These are HRA records. If they show CityFHEPS or FHEPS rental assistance, set cityFHEPS=true. In findings, summarize the subsidy/tenant share, any one-shot deal history, and whether arrears are covered or pending; note that the landlord may not demand more than the tenant share.`,
  dos: `This is NYS Department of State corporate registration / filing history. In findings, state whether the petitioner entity is registered and active and authorized to sue, the registered agent, and any DBA; an unregistered or dissolved entity may support a capacity/standing defense.`,
  priorCases: `These are prior cases between the parties. In findings, list prior L&T index numbers, the proceeding types, outcomes, and any stipulations or prior habitability claims. Note whether the current arrears overlap a prior judgment/stipulation (claim/issue preclusion) and whether a long collection gap supports laches; set staleRent=true if the records show stale arrears.`,
};

// ---------------------------------------------------------------------------
// ISSUE-SPOTTING KNOWLEDGE BASE
// "strength": strong | moderate | flag (flag = unsettled/attorney-decision-required)
// ---------------------------------------------------------------------------
function spotIssues(f) {
  const issues = [];
  const add = (o) => issues.push(o);
  const money = (s) => {
    if (s === undefined || s === null || s === "") return null;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  };

  const isNonpay = f.proceedingType === "nonpayment";
  const isHoldover = f.proceedingType === "holdover";

  if (isNonpay) {
    const demand = money(f.demandAmount);
    const petition = money(f.petitionAmount);
    const ledger = money(f.ledgerAmount);
    if (demand !== null && petition !== null && Math.abs(demand - petition) > 0.5) {
      add({
        id: "demand_mismatch",
        title: "14-day rent demand does not match petition amount",
        strength: "strong",
        because: `The rent demand seeks $${demand.toFixed(2)} but the petition seeks $${petition.toFixed(2)}. A demand that misstates the rent is not a good-faith approximation of the sum actually due and, as a defective condition precedent that cannot be amended, requires dismissal.`,
        cites: ["dendy", "pantigo", "severine", "chinatown", "rpapl711"],
        defense: "FIRST DEFENSE: DEFECTIVE RENT DEMAND",
      });
    }
    if (demand !== null && ledger !== null && Math.abs(demand - ledger) > 0.5) {
      add({
        id: "demand_ledger",
        title: "Rent demand is inconsistent with the rent ledger",
        strength: "moderate",
        because: `The demand ($${demand.toFixed(2)}) and the landlord's own ledger ($${ledger.toFixed(2)}) do not reconcile, indicating the demand was not prepared in good faith.`,
        cites: ["arthur", "jdm", "dendy"],
        defense: "DEFECTIVE RENT DEMAND (LEDGER DISCREPANCY)",
      });
    }
    if (f.demandIncludesFees) {
      add({
        id: "rpapl702",
        title: "Demand improperly includes fees / late charges / 'additional rent'",
        strength: "strong",
        because: "A summary proceeding may recover only 'rent.' Lumping late fees, 'additional rent,' or other non-rent charges into the demand overstates the good-faith amount and voids the demand.",
        cites: ["rpapl702", "rpl238a", "dendy"],
        defense: "DEFECTIVE RENT DEMAND (NON-RENT CHARGES)",
      });
    }
    if (f.demandPostdates) {
      add({
        id: "demand_future",
        title: "Demand seeks rent for months not yet due",
        strength: "moderate",
        because: "A 14-day demand that seeks rent for periods postdating the demand overstates the good-faith amount actually owed when the demand was made.",
        cites: ["dendy", "rpapl711"],
        defense: "DEFECTIVE RENT DEMAND (PREMATURE PERIODS)",
      });
    }
    if (f.no235e) {
      add({
        id: "rpl235e",
        title: "No RPL § 235-e(d) certified-mail reminder notice",
        strength: "moderate",
        because: "Where rent was not received within five days of the due date, failure to send the statutory certified-mail reminder is an affirmative defense in a nonpayment proceeding.",
        cites: ["rpl235e"],
        defense: "AFFIRMATIVE DEFENSE: FAILURE TO SERVE § 235-e(d) NOTICE",
      });
    }
  }

  if (isHoldover) {
    if (f.noticeNoLeaseProvision) {
      add({
        id: "no_lease_provision",
        title: "Predicate notice fails to specify the lease provision violated",
        strength: "strong",
        because: "A notice that does not cite the specific lease provision allegedly violated is fatally defective because the tenant cannot know what to cure; the defect cannot be cured by later amendment of the petition.",
        cites: ["chinatown", "rsc25242", "oxford"],
        defense: "DEFECTIVE PREDICATE NOTICE (UNSPECIFIED LEASE PROVISION)",
      });
    }
    if (f.noticeVague) {
      add({
        id: "notice_vague",
        title: "Predicate notice lacks fact particularity to frame a defense",
        strength: "strong",
        because: "Measured against the reasonableness standard, a notice that omits facts within the landlord's knowledge (e.g., specific dates, the conduct complained of) leaves the tenant unable to frame a defense and is defective.",
        cites: ["hughes", "oxford", "treanor", "rsc25242"],
        defense: "DEFECTIVE PREDICATE NOTICE (INSUFFICIENT PARTICULARITY)",
      });
    }
    if (f.noticeDateConflict) {
      add({
        id: "notice_dates",
        title: "Predicate notice contains inconsistent or impossible dates",
        strength: "strong",
        because: "Predicate notices must be clear, unambiguous, and unequivocal. Contradictory or impossible cure and termination dates render the notice ineffective to terminate the tenancy.",
        cites: ["ellivkroy", "chinatown"],
        defense: "DEFECTIVE PREDICATE NOTICE (CONTRADICTORY DATES)",
      });
    }
  }

  if (f.lihtc && f.groundRecert) {
    add({
      id: "lihtc_hera",
      title: "LIHTC recertification holdover — HERA 100%-building defense (UNSETTLED)",
      strength: "flag",
      because: "For a 100%-affordable LIHTC building, federal law (HERA 2008) eliminated the annual income-recertification requirement. Where the only source of the recertification obligation is the private lease rider — not federal law — there is a strong argument that failure to recertify is neither a substantial obligation of the tenancy nor 'good cause.' This is UNSETTLED: Bronx trial courts have upheld such holdovers, no appellate court has ruled, and the question is being litigated at scale (River Park Towers). Confirm the building is genuinely 100% affordable.",
      cites: ["irc42g8", "cfr1425", "soto", "dejesus", "bracero", "deabreu", "brown"],
      defense: "DEFENSE: NO GOOD CAUSE — FEDERAL LAW DOES NOT REQUIRE RECERTIFICATION (100% LIHTC)",
    });
    add({
      id: "lihtc_goodcause",
      title: "LIHTC good-cause eviction protection (extended use agreement)",
      strength: "moderate",
      because: "The recorded extended low-income housing commitment prohibits eviction or termination of tenancy other than for good cause for the entire extended use period. 'Good cause' is supplied by state law; a recertification technicality may not qualify.",
      cites: ["irc42", "revrul"],
      defense: "DEFENSE: VIOLATION OF LIHTC GOOD-CAUSE EVICTION PROTECTION",
    });
    add({
      id: "lihtc_voluntary",
      title: "Voluntary participation — no conditional limitation in lease",
      strength: "moderate",
      because: "Absent an express condition in the lease requiring the tenant to maintain a subsidy or complete recertification, a tenant's participation is voluntary and its lapse cannot support a holdover.",
      cites: ["soto", "dejesus"],
      defense: "DEFENSE: VOLUNTARY PARTICIPATION / NO CONDITIONAL LIMITATION",
    });
  }

  if (f.section8) {
    add({
      id: "s8_notice",
      title: "Section 8: owner must serve the PHA a copy of the eviction notice",
      strength: "moderate",
      because: "Under federal voucher rules the owner must give the PHA (here, NYCHA) a copy of any owner eviction notice; during the lease term the owner may terminate only for serious or repeated lease violation, violation of law, or other good cause.",
      cites: ["cfr982310"],
      defense: "DEFENSE: NONCOMPLIANCE WITH SECTION 8 TERMINATION REQUIREMENTS (24 C.F.R. § 982.310)",
    });
    add({
      id: "s8_share",
      title: "Section 8: tenant not liable for the subsidy (HAP) share",
      strength: "strong",
      because: "The tenant is not responsible for the portion of the rent covered by the housing assistance payment, and the owner may not terminate the tenancy for the PHA's nonpayment of its share.",
      cites: ["cfr982310", "khan"],
      defense: "DEFENSE: TENANT NOT LIABLE FOR SUBSIDY PORTION",
    });
  }

  if (f.mitchellLama) {
    add({
      id: "ml_procedure",
      title: "Mitchell-Lama: agency approval / certificate may be a prerequisite",
      strength: "flag",
      because: "Mitchell-Lama tenancies are agency-supervised; depending on the ground asserted, supervising-agency approval or a certificate of eviction may be a prerequisite, and a predicate notice that invokes only a private lease rider while ignoring the Mitchell-Lama framework is vulnerable. Confirm the supervising agency (HCR vs. HPD) and the procedure for the specific ground.",
      cites: [],
      defense: "DEFENSE: FAILURE TO COMPLY WITH MITCHELL-LAMA EVICTION PROCEDURES",
    });
  }

  if (f.cityFHEPS) {
    add({
      id: "fheps_share",
      title: "CityFHEPS/FHEPS: tenant liable only for tenant share; no side deals",
      strength: "strong",
      because: "Under the CityFHEPS rules the landlord may not collect more than the tenant share, side deals are prohibited, and late payment of the subsidy portion is deemed timely if paid in the month due. A demand that lumps the subsidy portion into the tenant's arrears is defective.",
      cites: ["khan", "rpapl711"],
      defense: "DEFENSE: IMPROPER DEMAND OF SUBSIDY PORTION (CityFHEPS)",
    });
  }

  if (f.rentStabilized) {
    if (f.notRegistered) {
      add({
        id: "rs_registration",
        title: "DHCR non-registration rent freeze",
        strength: "strong",
        because: "Failure to file proper and timely annual rent registrations bars the owner from collecting any rent above the legal regulated rent in effect on the date of the last preceding registration, until a proper registration is filed.",
        cites: ["rsl26517", "rsc25284"],
        defense: "DEFENSE: RENT FREEZE FOR FAILURE TO REGISTER WITH DHCR",
      });
    }
    if (f.overchargeSuspected) {
      add({
        id: "rs_overcharge",
        title: "Rent overcharge (post-Regina / post-Harvey framework) + ample-need discovery",
        strength: "flag",
        because: "Where the registered or collected rent appears improper, an overcharge defense may lie. For pre-June 14, 2019 overcharges the four-year lookback and base-date method govern absent a colorable claim of fraud (Regina). For tenancies that commenced AFTER HSTPA, the First Department in Harvey held the HSTPA amendments apply without a problematic retroactive effect, and a tenant need only raise an issue that the rent history is unreliable to obtain discovery. Obtaining the rent history still requires an ample-need discovery motion.",
        cites: ["regina", "westpierre", "fieldbridge", "farkas", "mautnerglick", "cplr408"],
        defense: "DEFENSE AND COUNTERCLAIM: RENT OVERCHARGE",
      });
    }
  }

  if (f.habitability) {
    add({
      id: "woh",
      title: "Breach of warranty of habitability (defense + counterclaim)",
      strength: "strong",
      because: "Conditions dangerous or detrimental to life, health, and safety, of which the landlord had notice, breach the implied warranty of habitability, relieving the tenant of rent to the extent of the diminished value and supporting an abatement and an order to correct.",
      cites: ["rpl235b", "parkwest", "solow", "cca110", "mdl302a", "hmc"],
      defense: "DEFENSE AND COUNTERCLAIM: BREACH OF WARRANTY OF HABITABILITY",
    });
  }

  if (isNonpay && f.staleRent) {
    add({
      id: "laches",
      title: "Laches / stale rent",
      strength: "moderate",
      because: "Unreasonable delay in commencing the proceeding to collect old arrears, causing prejudice to the tenant, supports dismissal of the possessory claim for the stale balance under the doctrine of laches.",
      cites: [],
      defense: "AFFIRMATIVE DEFENSE: LACHES",
    });
  }

  if (f.serviceDefect) {
    add({
      id: "service",
      title: "Improper service of predicate notice or petition",
      strength: "moderate",
      because: "Defective service of the predicate notice or the notice of petition and petition deprives the court of personal jurisdiction and supports dismissal.",
      cites: ["cplr3211"],
      defense: "DEFENSE: IMPROPER SERVICE",
    });
  }

  if (f.leaseHasFees) {
    add({
      id: "fees",
      title: "Reciprocal attorneys' fees",
      strength: "moderate",
      because: "Where the lease affords the landlord attorneys' fees, the tenant is entitled by reciprocity to reasonable fees as the prevailing party.",
      cites: ["rpl234"],
      defense: "COUNTERCLAIM: ATTORNEYS' FEES",
    });
  }

  // ----- No valid certificate of occupancy (MDL 301/302) -----
  if (f.noValidCofO) {
    add({
      id: "cofo",
      title: "No valid certificate of occupancy — landlord barred from recovering rent",
      strength: "strong",
      because: "Under Multiple Dwelling Law §§ 301 and 302, where a multiple dwelling is occupied without a valid certificate of occupancy — including where the subject unit was created or altered (e.g., a unit subdivided) without an updated C of O — no rent is recoverable for the period of noncompliance, and the petition fails to state a cause of action. The defense is grounded in Court of Appeals and Appellate Term authority.",
      cites: ["mdl301", "mdl302", "chazon", "smalls", "cplr3211", "leon"],
      defense: "DEFENSE: NO VALID CERTIFICATE OF OCCUPANCY (MDL §§ 301, 302)",
    });
  }

  // ----- Mandatory Notice of Petition form defect -----
  if (f.wrongNopForm) {
    add({
      id: "nop_form",
      title: "Notice of Petition does not use the mandatory court form",
      strength: "moderate",
      because: "The notice of petition must use the form prescribed by the Chief Administrative Judge (Administrative Order AO/163/19; 22 NYCRR § 208.42(b)). Several courts have held that failure to use the mandatory form years after it became effective is a defect in the commencement of the proceeding that warrants dismissal and cannot be cured by amendment, treating a substantive error in the notice of petition like a defective predicate notice. This is a trial-level development; confirm the current state of the law.",
      cites: ["nycrr20842", "ao16319", "cplr3211"],
      defense: "DEFENSE: FAILURE TO USE THE MANDATORY NOTICE OF PETITION FORM",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// FILE + JSON HELPERS
// ---------------------------------------------------------------------------
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      res(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function parseJSON(text) {
  if (!text) return null;
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

function mergeExtraction(prev, ext) {
  const next = { ...prev };
  const fields = (ext && ext.fields) || {};
  Object.entries(fields).forEach(([k, v]) => {
    if (k === "proceedingTypeSuggestion") return;
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "boolean") {
      if (v === true) next[k] = true;
      return;
    }
    if (k === "habitabilityConditions") {
      if (next[k] && String(next[k]).trim()) {
        if (!String(next[k]).includes(String(v))) next[k] = next[k] + "; " + v;
      } else {
        next[k] = v;
      }
      return;
    }
    if (k === "petitionParagraphs") {
      next[k] = String(v).replace(/[^0-9]/g, "") || next[k];
      return;
    }
    if (!next[k] || !String(next[k]).trim()) next[k] = String(v);
  });
  return next;
}

// ---------------------------------------------------------------------------
// PROMPT CONSTRUCTION
// ---------------------------------------------------------------------------
function buildCiteText(ids) {
  return ids.map((id) => `- ${CITES[id] || id}`).join("\n");
}

function selectedCiteList(selectedIssues) {
  const set = new Set();
  selectedIssues.forEach((i) => (i.cites || []).forEach((c) => set.add(c)));
  return Array.from(set);
}

function buildExtractionPrompt(id) {
  const slot = DOC_SLOTS.find((s) => s.id === id);
  const guidance = DOC_GUIDANCE[id] || "Extract any facts relevant to defending a Bronx Housing Court summary proceeding.";
  return `You are reading a document for a tenant-defense attorney at Bronx Legal Services preparing to defend a summary proceeding (nonpayment or holdover) in Bronx Housing Court.

Read the attached document and extract ONLY facts you can verify from its text. Do not guess. If a field is not addressed by this document, leave it empty (for strings) or null (for booleans). Current law is post-HSTPA (2019): a residential rent demand is a 14-day demand, never a 3-day demand.

DOCUMENT TYPE: ${slot ? slot.label : id}
WHAT TO LOOK FOR IN THIS DOCUMENT:
${guidance}

For any boolean, set true ONLY if the document affirmatively supports it. Never set a boolean to false; use null when the document does not address it.

Return ONLY a JSON object (no markdown, no backticks, no preamble) in exactly this shape:
{
  "fields": {
    "petitioner": "",
    "respondent": "",
    "premises": "",
    "indexNumber": "",
    "part": "",
    "petitionAmount": "",
    "demandAmount": "",
    "ledgerAmount": "",
    "petitionParagraphs": "",
    "proceedingTypeSuggestion": "",
    "rentStabilized": null,
    "notRegistered": null,
    "overchargeSuspected": null,
    "lihtc": null,
    "mitchellLama": null,
    "section8": null,
    "cityFHEPS": null,
    "leaseHasFees": null,
    "habitability": null,
    "habitabilityConditions": "",
    "groundRecert": null,
    "staleRent": null,
    "demandIncludesFees": null,
    "noticeNoLeaseProvision": null,
    "noticeVague": null,
    "noticeDateConflict": null,
    "noValidCofO": null,
    "wrongNopForm": null
  },
  "findings": "One to three sentences: what this document shows and why it matters for the tenant's defense. Note anything the attorney must verify."
}`;
}

function buildPrompt(f, doc, selectedIssues, docFindings, knowledgeBase) {
  const allowedCites = selectedCiteList(selectedIssues);
  const citeBlock = allowedCites.length ? buildCiteText(allowedCites) : "(none selected)";

  // The curated knowledge base (legal_kb.json) is bundled into the app and is
  // ALWAYS included. The textarea adds optional, matter-specific supplemental
  // notes on top of it.
  const supplemental = (knowledgeBase || "").trim();
  const kbBlock = supplemental
    ? `${BUNDLED_KB}\n\n--- ADDITIONAL ATTORNEY NOTES (entered for this matter) ---\n${supplemental}`
    : BUNDLED_KB;

  const issueBlock = selectedIssues
    .map(
      (i, n) =>
        `${n + 1}. ${i.defense}\n   Theory: ${i.because}\n   Authority you may cite for this point: ${(i.cites || [])
          .map((c) => CITES[c] || c)
          .join("; ")}`
    )
    .join("\n\n");

  const findingsBlock =
    docFindings && docFindings.length
      ? docFindings
          .filter((d) => !d.error)
          .map((d) => `- [${d.label}] ${d.text}`)
          .join("\n")
      : "(no document findings)";

  const facts = `
PROCEEDING TYPE: ${f.proceedingType}
COURT: Civil Court of the City of New York, County of Bronx, Housing Part ${f.part || "___"}
INDEX NUMBER: ${f.indexNumber || "L&T __________/____"}
PETITIONER: ${f.petitioner || "____"}
RESPONDENT(S): ${f.respondent || "____"}${f.includeDoes ? '; "JOHN DOE" and "JANE DOE"' : ""}
PREMISES: ${f.premises || "____"}
ATTORNEY: ${f.attorneyName || "____"}, Bronx Legal Services
ATTORNEY ADDRESS: ${f.attorneyAddress || "____"}
ATTORNEY EMAIL/PHONE: ${f.attorneyEmail || "____"} / ${f.attorneyPhone || "____"}
NUMBER OF NUMBERED PARAGRAPHS IN PETITION: ${f.petitionParagraphs || "(unknown)"}
REGULATORY STATUS: ${[
    f.rentStabilized && "Rent-stabilized",
    f.lihtc && "LIHTC / Section 42",
    f.mitchellLama && "Mitchell-Lama (PHFL Art. 2)",
    f.section8 && "Section 8 voucher",
    f.cityFHEPS && "CityFHEPS/FHEPS",
  ]
    .filter(Boolean)
    .join(", ") || "(not specified)"}
KEY FACTS / NARRATIVE FROM ATTORNEY:
${f.narrative || "(none provided)"}
HABITABILITY CONDITIONS (if any): ${f.habitabilityConditions || "(none provided)"}
`.trim();

  const docInstructions = {
    answer: `Draft a VERIFIED ANSWER for the respondent-tenant. Structure:
1) Caption block (court, county, Housing Part, parties, index number, document title "VERIFIED ANSWER WITH AFFIRMATIVE DEFENSES AND COUNTERCLAIMS").
2) An opening paragraph stating respondent answers through undersigned counsel.
3) Admissions/denials: produce numbered paragraphs responding to each of the petition's numbered paragraphs (use the count provided; where unknown, produce a reasonable set and mark unknowns). Use "admits," "denies," and "lacks knowledge or information sufficient to form a belief as to the truth of" formulations.
4) Each selected affirmative defense as a separately captioned, numbered, fully-developed section with the supporting facts and the cited authority woven in.
5) Each selected counterclaim as a separately captioned, numbered section with a demand for relief.
6) A WHEREFORE clause requesting dismissal, abatement (if habitability), attorneys' fees (if applicable), and such other relief.
7) Attorney verification block under CPLR §§ 3020, 3021 / RPAPL § 743, with the reason for attorney verification.
8) A word-count certification under 22 NYCRR § 202.8-b.`,
    motion_dismiss: `Draft a NOTICE OF MOTION TO DISMISS plus a supporting ATTORNEY AFFIRMATION and a MEMORANDUM OF LAW for the respondent-tenant under CPLR § 3211(a)(7) (and § 3211(a)(8) if a service defect is selected). Structure:
1) Caption block and document title "NOTICE OF MOTION."
2) Notice of motion stating the relief sought and the return date placeholder.
3) Attorney affirmation reciting the procedural facts and attaching the predicate documents as exhibits (reference them).
4) A memorandum of law with: Preliminary Statement; Statement of Facts; a Standard of Review section on CPLR § 3211(a)(7); an Argument with a separately headed Point for each selected defense, fully developed with the cited authority; and a Conclusion.
5) A word-count certification under 22 NYCRR § 202.8-b.
Match the persuasive depth and structure of a high-quality Bronx Legal Services memorandum.`,
    motion_sj: `Draft a NOTICE OF MOTION FOR SUMMARY JUDGMENT plus a supporting ATTORNEY AFFIRMATION, a CLIENT AFFIDAVIT template, and a MEMORANDUM OF LAW for the respondent-tenant under CPLR § 3212, dismissing the petition. Note that issue must be joined. Structure parallel to a motion to dismiss but framed for summary judgment (no triable issue of fact as to the selected defenses). Include the CPLR § 3212 standard and, where useful, CPLR § 409(b) summary determination. Include a word-count certification under 22 NYCRR § 202.8-b. Flag in a bracketed note that an affidavit from a person with knowledge is required.`,
    motion_amend: `Draft a NOTICE OF MOTION FOR LEAVE TO AMEND THE ANSWER plus a supporting ATTORNEY AFFIRMATION and a brief MEMORANDUM OF LAW under CPLR § 3025(b), with the PROPOSED AMENDED ANSWER annexed. Leave is freely given absent prejudice. The proposed amended answer should incorporate the selected defenses and counterclaims in full verified-answer form. Include a word-count certification under 22 NYCRR § 202.8-b.`,
  };

  return `You are assisting a licensed New York attorney at Bronx Legal Services who represents a respondent-tenant in a summary proceeding in Bronx Housing Court. You are drafting a pleading the attorney will review, verify, and file. Write at the level of a strong, persuasive, well-organized legal-services brief: precise, plain, and forceful, never padded.

ABSOLUTE RULES:
- Cite ONLY authorities that appear in the ALLOWED AUTHORITIES list below OR in the ATTORNEY'S KNOWLEDGE BASE below. The knowledge base is curated and verified by the attorney; you may rely on its case summaries, holdings, and tactical analysis, and you may cite any case, statute, or regulation it contains. Never invent, paraphrase into existence, or add any authority that appears in NEITHER source. If a proposition needs authority found in neither source, state the proposition without a citation and insert "[ATTORNEY: add authority]".
- Where the knowledge base and the curated list both bear on a point, prefer the framing and the specific holdings supplied by the knowledge base, since it reflects the attorney's own vetted research for this practice.
- Do not assert facts beyond those provided. Where a fact is needed but not supplied, insert a clearly bracketed placeholder like "[DATE]" or "[AMOUNT]".
- For any defense marked UNSETTLED in the theory, include a short bracketed note "[ATTORNEY NOTE: unsettled — verify current law and the building's status before filing]".
- Produce a clean, court-ready document in plain text with conventional legal formatting (centered court caption represented with line breaks, numbered paragraphs, headed sections). Do not use Markdown headers or bullet characters; use legal numbering and ALL-CAPS section headings.
- Match Bronx Civil Court Housing Part conventions.

CURRENT LAW GUARDRAILS (POST-HSTPA — MANDATORY):
- The Housing Stability and Tenant Protection Act of 2019 (HSTPA), L. 2019, c. 36, governs. Apply current law only.
- In a residential NONPAYMENT proceeding the statutory rent demand is a FOURTEEN (14) DAY written demand under RPAPL § 711(2) as amended. NEVER refer to a "three-day demand," "3-day notice," or any pre-2019 demand period; that requirement was eliminated in 2019. Any reference to a 3-day rent demand is a legal error.
- Late fees are capped and may not be demanded or recovered as "rent" in a summary proceeding (RPL § 238-a); do not treat late fees or "additional rent" as recoverable rent.
- Do not rely on any pre-2019 procedure that HSTPA changed.

DOCUMENT TO DRAFT:
${docInstructions[doc]}

CASE INFORMATION:
${facts}

DOCUMENT-DERIVED FINDINGS (extracted from the attorney's uploaded records; treat as attorney-supplied context, use only what is relevant, and insert a bracketed placeholder where a finding must be confirmed before filing):
${findingsBlock}

ATTORNEY'S KNOWLEDGE BASE (curated case law, issue-spotting analysis, and drafting tactics the attorney maintains and has verified for Bronx Housing Court tenant defense — treat as an authoritative source on par with the curated list; mine it for the strongest on-point authority and arguments, and use whatever is relevant to sharpen the analysis and strengthen this draft):
${kbBlock}

SELECTED DEFENSES / COUNTERCLAIMS TO DEVELOP (develop every one fully, in this order):
${issueBlock || "(none selected — draft only the denials and a general reservation of defenses)"}

ALLOWED AUTHORITIES (the curated library; you may also cite anything contained in the attorney's knowledge base above):
${citeBlock}

Now draft the complete document.`;
}

// ---------------------------------------------------------------------------
// CLAUDE API CALL
// ---------------------------------------------------------------------------
async function callClaude(apiKey, { prompt, documents = [], maxTokens = 8000 }) {
  const content = [];
  documents.forEach((d) => {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: d },
    });
  });
  content.push({ type: "text", text: prompt });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j?.error?.message || JSON.stringify(j);
    } catch (e) {
      detail = await resp.text();
    }
    throw new Error(`API error ${resp.status}: ${detail}`);
  }
  const data = await resp.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

// ---------------------------------------------------------------------------
// UI PRIMITIVES
// ---------------------------------------------------------------------------
const COLORS = {
  ink: "#1a1f2b",
  paper: "#fbfaf7",
  panel: "#ffffff",
  line: "#d9d4c7",
  rule: "#e7e2d6",
  accent: "#7a2e2e",
  accentSoft: "#a85b5b",
  muted: "#6b6557",
  strong: "#1f6f43",
  moderate: "#9a6b1e",
  flag: "#7a2e2e",
  chipBg: "#f1ede3",
};

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, letterSpacing: 0.3, textTransform: "uppercase", color: COLORS.muted, marginBottom: 5, fontWeight: 600 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4, fontStyle: "italic" }}>{hint}</div>}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  fontSize: 14,
  fontFamily: "'Iowan Old Style', Georgia, serif",
  background: COLORS.panel,
  color: COLORS.ink,
  boxSizing: "border-box",
};

function Text({ value, onChange, placeholder }) {
  return <input style={inputStyle} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Area({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
      rows={rows}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Check({ label, checked, onChange, sub }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 0", cursor: "pointer", borderBottom: `1px solid ${COLORS.rule}` }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, accentColor: COLORS.accent, width: 15, height: 15 }} />
      <span>
        <span style={{ fontSize: 14, color: COLORS.ink }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 12, color: COLORS.muted }}>{sub}</span>}
      </span>
    </label>
  );
}

function StrengthDot({ s }) {
  const c = s === "strong" ? COLORS.strong : s === "moderate" ? COLORS.moderate : COLORS.flag;
  const label = s === "strong" ? "Strong" : s === "moderate" ? "Moderate" : "Unsettled — verify";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 9, background: c, display: "inline-block" }} />
      <span style={{ fontSize: 11, color: c, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    ready: { t: "Ready", c: COLORS.muted, bg: "#f1ede3" },
    reading: { t: "Reading…", c: COLORS.moderate, bg: "#f6efe0" },
    done: { t: "Extracted", c: COLORS.strong, bg: "#eef3ee" },
    error: { t: "Error", c: COLORS.accent, bg: "#f7ecec" },
  };
  const m = map[status] || map.ready;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: m.c, background: m.bg, padding: "2px 7px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.3 }}>
      {m.t}
    </span>
  );
}

function DocSlot({ slot, data, onPick, onRemove }) {
  const ref = useRef(null);
  const name = data?.name;
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 5, padding: "9px 11px", background: name ? "#fcfbf8" : COLORS.panel }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.ink, marginBottom: 6 }}>{slot.label}</div>
      {name ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: COLORS.muted, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
            {name}
          </span>
          <StatusPill status={data.status} />
          <button onClick={onRemove} style={{ marginLeft: "auto", border: "none", background: "transparent", color: COLORS.accent, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }} title="Remove">
            ×
          </button>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          style={{ width: "100%", padding: "7px 0", border: `1px dashed ${COLORS.line}`, background: COLORS.panel, color: COLORS.muted, borderRadius: 4, fontFamily: "inherit", fontSize: 12.5, cursor: "pointer" }}
        >
          Upload PDF
        </button>
      )}
      <input ref={ref} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = ""; }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [kbSaved, setKbSaved] = useState(true); // true = current text matches what's stored
  const [kbLoaded, setKbLoaded] = useState(false);
  const [f, setF] = useState({ proceedingType: "nonpayment", includeDoes: true });
  const [doc, setDoc] = useState("answer");
  const [excluded, setExcluded] = useState({});
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [docFiles, setDocFiles] = useState({});
  const [extracting, setExtracting] = useState(false);
  const [docFindings, setDocFindings] = useState([]);
  const [extractNote, setExtractNote] = useState("");
  const outRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("bxls_key");
        if (r && r.value) {
          setApiKey(r.value);
          setKeySaved(true);
        }
      } catch (e) {}
      try {
        const k = await storage.get("bxls_kb");
        if (k && k.value) {
          setKnowledgeBase(k.value);
          setKbSaved(true);
        }
      } catch (e) {}
      setKbLoaded(true);
    })();
  }, []);

  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));

  const issues = useMemo(() => spotIssues(f), [f]);
  const selectedIssues = issues.filter((i) => !excluded[i.id]);

  const saveKey = async () => {
    try {
      await storage.set("bxls_key", apiKey.trim());
    } catch (e) {}
    setKeySaved(true);
  };
  const clearKey = async () => {
    try {
      await storage.delete("bxls_key");
    } catch (e) {}
    setApiKey("");
    setKeySaved(false);
  };

  const onKbChange = (v) => {
    setKnowledgeBase(v);
    setKbSaved(false);
  };
  const saveKB = async () => {
    try {
      await storage.set("bxls_kb", knowledgeBase);
      setKbSaved(true);
    } catch (e) {
      setErr("Could not save the knowledge base to storage: " + String(e.message || e));
    }
  };
  const clearKB = async () => {
    try {
      await storage.delete("bxls_kb");
    } catch (e) {}
    setKnowledgeBase("");
    setKbSaved(true);
  };

  const pickDoc = (id) => async (file) => {
    try {
      const base64 = await fileToBase64(file);
      setDocFiles((prev) => ({ ...prev, [id]: { name: file.name, base64, status: "ready" } }));
    } catch (e) {
      setErr("Could not read file: " + file.name);
    }
  };
  const removeDoc = (id) => () => setDocFiles((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const uploadedCount = Object.values(docFiles).filter((d) => d?.base64).length;
  const kbChars = knowledgeBase.trim().length;

  const extractAll = async () => {
    setErr("");
    setExtractNote("");
    if (!apiKey.trim()) {
      setErr("Add your Anthropic API key in Settings first.");
      return;
    }
    const slots = DOC_SLOTS.filter((s) => docFiles[s.id]?.base64);
    if (slots.length === 0) {
      setErr("Upload at least one document to extract.");
      return;
    }
    setExtracting(true);
    setDocFindings([]);
    setDocFiles((prev) => {
      const n = { ...prev };
      slots.forEach((s) => { if (n[s.id]) n[s.id] = { ...n[s.id], status: "reading" }; });
      return n;
    });

    const results = await Promise.all(
      slots.map(async (s) => {
        try {
          const prompt = buildExtractionPrompt(s.id);
          const text = await callClaude(apiKey.trim(), { prompt, documents: [docFiles[s.id].base64], maxTokens: 3000 });
          const parsed = parseJSON(text);
          setDocFiles((prev) => (prev[s.id] ? { ...prev, [s.id]: { ...prev[s.id], status: parsed ? "done" : "error" } } : prev));
          return { id: s.id, label: s.label, parsed };
        } catch (e) {
          setDocFiles((prev) => (prev[s.id] ? { ...prev, [s.id]: { ...prev[s.id], status: "error" } } : prev));
          return { id: s.id, label: s.label, error: String(e.message || e) };
        }
      })
    );

    let merged = { ...f };
    const findings = [];
    let typeSuggestion = "";
    results.forEach((r) => {
      if (r.parsed && r.parsed.fields) {
        merged = mergeExtraction(merged, r.parsed);
        if (r.parsed.fields.proceedingTypeSuggestion) typeSuggestion = r.parsed.fields.proceedingTypeSuggestion;
      }
      if (r.parsed && r.parsed.findings) findings.push({ label: r.label, text: r.parsed.findings });
      if (r.error) findings.push({ label: r.label, text: "Could not read this document: " + r.error, error: true });
    });

    let note = "";
    if (typeSuggestion && /hold/i.test(typeSuggestion) && merged.proceedingType !== "holdover") {
      merged.proceedingType = "holdover";
      note = "Petition appears to be a HOLDOVER — proceeding type set to holdover.";
    } else if (typeSuggestion && /nonpay/i.test(typeSuggestion) && merged.proceedingType !== "nonpayment") {
      merged.proceedingType = "nonpayment";
      note = "Petition appears to be a NONPAYMENT — proceeding type set to nonpayment.";
    }

    setF(merged);
    setDocFindings(findings);
    setExtractNote(note);
    setExtracting(false);
  };

  const generate = async () => {
    setErr("");
    setOutput("");
    if (!apiKey.trim()) {
      setErr("Add your Anthropic API key in Settings first.");
      return;
    }
    setBusy(true);
    try {
      const prompt = buildPrompt(f, doc, selectedIssues, docFindings, knowledgeBase);
      const text = await callClaude(apiKey.trim(), { prompt, maxTokens: 16000 });
      setOutput(text);
      setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const copyOut = () => navigator.clipboard?.writeText(output);
  const downloadOut = () => {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const label = { answer: "Verified_Answer", motion_dismiss: "Motion_to_Dismiss", motion_sj: "Motion_Summary_Judgment", motion_amend: "Motion_to_Amend" }[doc];
    a.download = `${label}_${(f.indexNumber || "draft").replace(/[^\w]/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const docTabs = [
    { id: "answer", label: "Verified Answer" },
    { id: "motion_dismiss", label: "Motion to Dismiss" },
    { id: "motion_sj", label: "Summary Judgment" },
    { id: "motion_amend", label: "Leave to Amend" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, color: COLORS.ink, fontFamily: "'Iowan Old Style', Georgia, serif" }}>
      <header style={{ borderBottom: `2px solid ${COLORS.ink}`, padding: "22px 28px 18px", background: COLORS.panel }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: COLORS.accent, fontWeight: 700 }}>Bronx Legal Services · Tenant Defense</div>
            <h1 style={{ margin: "4px 0 0", fontSize: 30, fontWeight: 700, letterSpacing: -0.4 }}>Pleading Drafter</h1>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>Bronx Housing Court summary proceedings · responsive pleadings for respondent-tenants · Opus 4.8</div>
          </div>
          <SettingsButton apiKey={apiKey} setApiKey={setApiKey} keySaved={keySaved} saveKey={saveKey} clearKey={clearKey} />
        </div>
      </header>

      <div style={{ background: "#2a2520", color: "#f1ede3", fontSize: 12.5, padding: "8px 28px", textAlign: "center", letterSpacing: 0.2 }}>
        Draft generator for an admitted attorney. Every output requires independent review, verification, and Shepardizing before filing. Citations are limited to your curated library and saved knowledge base; confirm each one.
      </div>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 28px 80px", display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 28 }}>
        <section>
          <SectionTitle n="00" t="Knowledge Base" />
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: -6, marginBottom: 10, lineHeight: 1.5 }}>
            Your curated knowledge base — <strong>{KB_META.citeCount} cases</strong> and <strong>{KB_META.moduleCount} issue modules</strong> — is built into this app (from <code>legal_kb.json</code>) and pulled into <em>every</em> draft automatically. To add or change cases, edit <code>legal_kb.json</code> in GitHub and the live site updates itself. The box below is optional: add matter-specific notes for this draft only.
          </div>
          <div style={{ fontSize: 12, color: COLORS.strong, background: "#eef3ee", border: `1px solid ${COLORS.strong}`, borderRadius: 5, padding: "8px 11px", marginBottom: 10, lineHeight: 1.45 }}>
            ● Built-in knowledge base loaded: {KB_META.citeCount.toLocaleString()} authorities + {KB_META.moduleCount} issue modules, active on every draft.
          </div>
          <div style={{ border: `1px solid ${kbChars > 0 ? COLORS.strong : COLORS.line}`, borderRadius: 6, background: COLORS.panel, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                    padding: "2px 8px",
                    borderRadius: 3,
                    color: !kbLoaded ? COLORS.muted : kbChars === 0 ? COLORS.muted : kbSaved ? COLORS.strong : COLORS.moderate,
                    background: !kbLoaded ? "#f1ede3" : kbChars === 0 ? "#f1ede3" : kbSaved ? "#eef3ee" : "#f6efe0",
                  }}
                >
                  {!kbLoaded ? "Loading…" : kbChars === 0 ? "No extra notes" : kbSaved ? "● Notes saved" : "Unsaved notes"}
                </span>
                {kbChars > 0 && (
                  <span style={{ fontSize: 11.5, color: COLORS.muted }}>{kbChars.toLocaleString()} characters</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={saveKB}
                  disabled={kbSaved && kbChars > 0}
                  style={{
                    padding: "7px 14px",
                    background: kbSaved && kbChars > 0 ? "#cfc9bb" : COLORS.strong,
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: kbSaved && kbChars > 0 ? "default" : "pointer",
                  }}
                >
                  {kbSaved && kbChars > 0 ? "Saved" : "Save notes"}
                </button>
                <button onClick={clearKB} style={{ padding: "7px 12px", background: COLORS.panel, color: COLORS.muted, border: `1px solid ${COLORS.line}`, borderRadius: 4, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                  Clear
                </button>
              </div>
            </div>
            <Area
              value={knowledgeBase}
              onChange={onKbChange}
              rows={8}
              placeholder="Optional: matter-specific notes for this draft — extra facts, a case you want emphasized, or instructions. The built-in knowledge base above is always included; anything here is added on top."
            />
            <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 6, fontStyle: "italic" }}>
              Optional notes are saved only in this browser on this device (local storage) and are sent to Anthropic only when you draft. The built-in knowledge base is always active and needs no saving.
            </div>
          </div>

          <SectionTitle n="01" t="Documents & Auto-Extract" />
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
            Upload text PDFs from your case file. Opus 4.8 reads each one and fills the intake below. Review everything it extracts. Files are read at intake and held only in this browser session; uploading sends them to the Anthropic API — confirm this is consistent with your office's confidentiality and data-handling policy.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {DOC_SLOTS.map((s) => (
              <DocSlot key={s.id} slot={s} data={docFiles[s.id]} onPick={pickDoc(s.id)} onRemove={removeDoc(s.id)} />
            ))}
          </div>
          <button
            onClick={extractAll}
            disabled={extracting || uploadedCount === 0}
            style={{
              width: "100%",
              marginTop: 12,
              padding: "11px 0",
              background: extracting ? COLORS.muted : uploadedCount === 0 ? "#cfc9bb" : "#2a2520",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              fontFamily: "inherit",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.3,
              cursor: extracting || uploadedCount === 0 ? "default" : "pointer",
            }}
          >
            {extracting ? "Reading documents…" : uploadedCount === 0 ? "Upload documents to extract" : `Extract facts from ${uploadedCount} document${uploadedCount > 1 ? "s" : ""}`}
          </button>
          {extractNote && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: COLORS.strong, background: "#eef3ee", border: `1px solid ${COLORS.strong}`, borderRadius: 4, padding: "8px 10px" }}>{extractNote}</div>
          )}
          {docFindings.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid ${COLORS.line}`, borderRadius: 6, background: COLORS.panel, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: COLORS.muted, marginBottom: 8 }}>Document findings — verify before relying</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {docFindings.map((d, idx) => (
                  <div key={idx} style={{ fontSize: 12.5, lineHeight: 1.45, color: d.error ? COLORS.accent : COLORS.ink }}>
                    <span style={{ fontWeight: 700 }}>{d.label}:</span> {d.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <SectionTitle n="02" t="The Case" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Proceeding type">
              <div style={{ display: "flex", gap: 8 }}>
                {["nonpayment", "holdover"].map((t) => (
                  <button
                    key={t}
                    onClick={() => set("proceedingType")(t)}
                    style={{ flex: 1, padding: "9px 0", border: `1px solid ${f.proceedingType === t ? COLORS.accent : COLORS.line}`, background: f.proceedingType === t ? COLORS.accent : COLORS.panel, color: f.proceedingType === t ? "#fff" : COLORS.ink, borderRadius: 4, fontFamily: "inherit", fontSize: 14, cursor: "pointer", textTransform: "capitalize" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Housing Part">
              <Text value={f.part} onChange={set("part")} placeholder="e.g., B" />
            </Field>
          </div>
          <Field label="Index number">
            <Text value={f.indexNumber} onChange={set("indexNumber")} placeholder="L&T 310938-26/BX" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Petitioner (landlord)">
              <Text value={f.petitioner} onChange={set("petitioner")} placeholder="River Park Residences, L.P." />
            </Field>
            <Field label="Respondent (tenant)">
              <Text value={f.respondent} onChange={set("respondent")} placeholder="Tina Rodriguez" />
            </Field>
          </div>
          <Field label="Premises">
            <Text value={f.premises} onChange={set("premises")} placeholder="30 Richman Plaza, Apt. 18D, Bronx, NY 10453" />
          </Field>
          <Check label='Include "John Doe" / "Jane Doe" undertenants in caption' checked={f.includeDoes} onChange={set("includeDoes")} />

          {f.proceedingType === "nonpayment" && (
            <>
              <SectionTitle n="03" t="Rent Demand & Amounts" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="14-day demand amount"><Text value={f.demandAmount} onChange={set("demandAmount")} placeholder="$1,778.45" /></Field>
                <Field label="Petition amount"><Text value={f.petitionAmount} onChange={set("petitionAmount")} placeholder="$1,993.45" /></Field>
                <Field label="Ledger balance"><Text value={f.ledgerAmount} onChange={set("ledgerAmount")} placeholder="optional" /></Field>
              </div>
              <Check label="Demand includes late fees / 'additional rent' / non-rent charges" checked={f.demandIncludesFees} onChange={set("demandIncludesFees")} />
              <Check label="Demand seeks rent for months that postdate the demand" checked={f.demandPostdates} onChange={set("demandPostdates")} />
              <Check label="No § 235-e(d) certified-mail reminder notice was sent" checked={f.no235e} onChange={set("no235e")} />
              <Check label="Arrears are stale (long delay before filing)" checked={f.staleRent} onChange={set("staleRent")} />
            </>
          )}

          {f.proceedingType === "holdover" && (
            <>
              <SectionTitle n="03" t="Predicate Notice" />
              <Check label="Notice fails to specify the lease provision violated" checked={f.noticeNoLeaseProvision} onChange={set("noticeNoLeaseProvision")} sub="Chinatown defect" />
              <Check label="Notice lacks fact particularity to frame a defense" checked={f.noticeVague} onChange={set("noticeVague")} sub="reasonableness standard" />
              <Check label="Notice has inconsistent / impossible cure or termination dates" checked={f.noticeDateConflict} onChange={set("noticeDateConflict")} />
              <Check label="Ground asserted is failure to recertify (LIHTC/subsidy)" checked={f.groundRecert} onChange={set("groundRecert")} />
            </>
          )}

          <SectionTitle n="04" t="Regulatory Status" />
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "4px 14px" }}>
            <Check label="Rent-stabilized (incl. 421-a)" checked={f.rentStabilized} onChange={set("rentStabilized")} />
            {f.rentStabilized && (
              <div style={{ paddingLeft: 24 }}>
                <Check label="Not properly registered with DHCR" checked={f.notRegistered} onChange={set("notRegistered")} />
                <Check label="Overcharge / improper rent suspected" checked={f.overchargeSuspected} onChange={set("overchargeSuspected")} />
              </div>
            )}
            <Check label="LIHTC / Section 42 building" checked={f.lihtc} onChange={set("lihtc")} sub="100%-affordable triggers the HERA recertification defense" />
            <Check label="Mitchell-Lama (PHFL Article 2)" checked={f.mitchellLama} onChange={set("mitchellLama")} />
            <Check label="Section 8 voucher (e.g., NYCHA-administered)" checked={f.section8} onChange={set("section8")} />
            <Check label="CityFHEPS / FHEPS subsidy" checked={f.cityFHEPS} onChange={set("cityFHEPS")} />
            <Check label="Lease has an attorneys'-fees clause" checked={f.leaseHasFees} onChange={set("leaseHasFees")} />
            <Check label="Service of process appears defective" checked={f.serviceDefect} onChange={set("serviceDefect")} />
            <Check label="No valid certificate of occupancy / illegal alteration or unit" checked={f.noValidCofO} onChange={set("noValidCofO")} sub="MDL §§ 301-302 bar rent (Chazon; Smalls)" />
            <Check label="Notice of Petition does not use the mandatory court form" checked={f.wrongNopForm} onChange={set("wrongNopForm")} sub="22 NYCRR § 208.42(b) / AO 163/19" />
          </div>

          <SectionTitle n="05" t="Conditions & Narrative" />
          <Check label="Plead breach of warranty of habitability" checked={f.habitability} onChange={set("habitability")} />
          {f.habitability && (
            <Field label="Conditions (itemize)" hint="e.g., mold in bathroom and bedroom; broken refrigerator; leak since [date]">
              <Area value={f.habitabilityConditions} onChange={set("habitabilityConditions")} rows={3} />
            </Field>
          )}
          <Field label="Key facts for the drafter" hint="Plain narrative. Dates, what happened, what the client says. The model uses this; it will bracket anything missing.">
            <Area value={f.narrative} onChange={set("narrative")} rows={5} />
          </Field>

          <SectionTitle n="06" t="Attorney Block" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Attorney name"><Text value={f.attorneyName} onChange={set("attorneyName")} placeholder="Justin Brown, Of Counsel" /></Field>
            <Field label="Petition ¶ count" hint="how many numbered ¶s to answer"><Text value={f.petitionParagraphs} onChange={set("petitionParagraphs")} placeholder="e.g., 11" /></Field>
          </div>
          <Field label="Office address"><Text value={f.attorneyAddress} onChange={set("attorneyAddress")} placeholder="349 E 149th St, 10th Fl, Bronx, NY 10451" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Email"><Text value={f.attorneyEmail} onChange={set("attorneyEmail")} placeholder="jtbrown@lsnyc.org" /></Field>
            <Field label="Phone"><Text value={f.attorneyPhone} onChange={set("attorneyPhone")} placeholder="(718) 233-6498" /></Field>
          </div>
        </section>

        <section>
          <div style={{ position: "sticky", top: 18 }}>
            <SectionTitle n="—" t="Issues Spotted" />
            <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 12, marginTop: -6 }}>
              Defenses fire as you enter facts. Uncheck any you don't want drafted. {selectedIssues.length} of {issues.length} selected.
            </div>

            {issues.length === 0 && (
              <div style={{ padding: 18, border: `1px dashed ${COLORS.line}`, borderRadius: 6, color: COLORS.muted, fontSize: 13, textAlign: "center" }}>
                No issues yet. Upload documents and extract, or enter the rent-demand amounts, predicate-notice flags, and regulatory status to populate defenses.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "44vh", overflowY: "auto", paddingRight: 4 }}>
              {issues.map((i) => {
                const on = !excluded[i.id];
                return (
                  <div key={i.id} style={{ border: `1px solid ${on ? COLORS.line : COLORS.rule}`, borderLeft: `3px solid ${i.strength === "strong" ? COLORS.strong : i.strength === "moderate" ? COLORS.moderate : COLORS.flag}`, borderRadius: 5, padding: "11px 13px", background: on ? COLORS.panel : "#f6f4ee", opacity: on ? 1 : 0.6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{i.title}</div>
                      <input type="checkbox" checked={on} onChange={(e) => setExcluded((p) => ({ ...p, [i.id]: !e.target.checked }))} style={{ marginTop: 2, accentColor: COLORS.accent, width: 15, height: 15, flexShrink: 0 }} />
                    </div>
                    <div style={{ margin: "6px 0" }}>
                      <StrengthDot s={i.strength} />
                    </div>
                    <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.45 }}>{i.because}</div>
                    {i.cites && i.cites.length > 0 && (
                      <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {i.cites.map((c) => (
                          <span key={c} style={{ fontSize: 10.5, background: COLORS.chipBg, color: COLORS.ink, padding: "2px 6px", borderRadius: 3, border: `1px solid ${COLORS.rule}` }}>
                            {(CITES[c] || c).replace(/,.*$/, "").slice(0, 42)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 22, borderTop: `2px solid ${COLORS.ink}`, paddingTop: 16 }}>
              <div style={{ fontSize: 12, letterSpacing: 0.3, textTransform: "uppercase", color: COLORS.muted, marginBottom: 8, fontWeight: 600 }}>Document to draft</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 14 }}>
                {docTabs.map((t) => (
                  <button key={t.id} onClick={() => setDoc(t.id)} style={{ padding: "9px 8px", border: `1px solid ${doc === t.id ? COLORS.accent : COLORS.line}`, background: doc === t.id ? "#f3e9e9" : COLORS.panel, color: doc === t.id ? COLORS.accent : COLORS.ink, fontWeight: doc === t.id ? 700 : 400, borderRadius: 4, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                    {t.label}
                  </button>
                ))}
              </div>
              {(doc === "motion_sj" || doc === "motion_amend") && (
                <div style={{ fontSize: 11.5, color: COLORS.moderate, marginBottom: 10, lineHeight: 1.4 }}>
                  Note: {doc === "motion_sj" ? "summary judgment requires issue joined and a client affidavit from a person with knowledge." : "leave to amend annexes a proposed amended answer."} Review with extra care.
                </div>
              )}

              <div style={{ fontSize: 11.5, color: COLORS.strong, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: COLORS.strong, display: "inline-block" }} />
                Drawing on the built-in knowledge base ({KB_META.citeCount} cases + {KB_META.moduleCount} modules){kbChars > 0 ? ` plus your notes (${kbChars.toLocaleString()} chars)` : ""}.
              </div>

              <button onClick={generate} disabled={busy} style={{ width: "100%", padding: "13px 0", background: busy ? COLORS.muted : COLORS.accent, color: "#fff", border: "none", borderRadius: 5, fontFamily: "inherit", fontSize: 15, fontWeight: 700, letterSpacing: 0.3, cursor: busy ? "default" : "pointer" }}>
                {busy ? "Drafting…" : `Draft ${docTabs.find((t) => t.id === doc).label}`}
              </button>
              {err && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: COLORS.accent, background: "#f7ecec", border: `1px solid ${COLORS.accentSoft}`, borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>{err}</div>
              )}
            </div>
          </div>
        </section>
      </main>

      {output && (
        <div ref={outRef} style={{ borderTop: `2px solid ${COLORS.ink}`, background: COLORS.panel }}>
          <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 28px 60px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <SectionTitle n="07" t="Draft" inline />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={copyOut} style={ghostBtn}>Copy</button>
                <button onClick={downloadOut} style={ghostBtn}>Download (.txt)</button>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 14, fontStyle: "italic" }}>
              Review every line. Fill bracketed placeholders. Confirm each citation — including any drawn from your knowledge base. Verify before filing. For a Word file, paste into your office template.
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 14.5, lineHeight: 1.6, color: COLORS.ink, background: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "26px 30px", margin: 0 }}>
              {output}
            </pre>
          </div>
        </div>
      )}

      <footer style={{ borderTop: `1px solid ${COLORS.line}`, padding: "16px 28px", textAlign: "center", fontSize: 12, color: COLORS.muted }}>
        Curated authority + your saved knowledge base · attorney-in-the-loop · documents read at intake (NYSCEF must be uploaded by counsel; no scraping). Not legal advice.
      </footer>
    </div>
  );
}

const ghostBtn = {
  padding: "7px 14px",
  background: COLORS.panel,
  color: COLORS.ink,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  fontFamily: "'Iowan Old Style', Georgia, serif",
  fontSize: 13,
  cursor: "pointer",
};

function SectionTitle({ n, t, inline }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: inline ? 0 : "22px 0 12px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 }}>{n}</span>
      <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.2 }}>{t}</span>
      {!inline && <span style={{ flex: 1, height: 1, background: COLORS.rule }} />}
    </div>
  );
}

function SettingsButton({ apiKey, setApiKey, keySaved, saveKey, clearKey }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ padding: "8px 15px", background: keySaved ? "#eef3ee" : "#f7ecec", color: keySaved ? COLORS.strong : COLORS.accent, border: `1px solid ${keySaved ? COLORS.strong : COLORS.accentSoft}`, borderRadius: 5, fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        {keySaved ? "● API key saved" : "○ Add API key"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 44, width: 340, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, boxShadow: "0 12px 32px rgba(0,0,0,0.18)", padding: 16, zIndex: 50 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Anthropic API key</div>
          <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.45, marginBottom: 10 }}>
            Saved to your Claude account for this tool, so it persists and follows you across devices when you're signed in. Sent only to Anthropic when you extract or draft. Starts with <code>sk-ant-</code>. Press Clear to remove it, and rotate it at console.anthropic.com.
          </div>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-..." style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => { saveKey(); setOpen(false); }} style={{ flex: 1, padding: "9px 0", background: COLORS.accent, color: "#fff", border: "none", borderRadius: 4, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save</button>
            <button onClick={clearKey} style={{ padding: "9px 14px", background: COLORS.panel, color: COLORS.muted, border: `1px solid ${COLORS.line}`, borderRadius: 4, fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"software engineer","location":"San Francisco Bay Area","limit":10}
// output.field: {"rank":"jobs.rank","title":"jobs.title","company":"jobs.company","location":"jobs.location","listed":"jobs.listed","salary":"jobs.salary","url":"jobs.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "linkedin-cookie"
// auth.description: "linkedin auth credential"
// tags: ["foreign"]

async () => {
  const EXPERIENCE_LEVELS = {
    internship: "1",
    entry: "2",
    "entry-level": "2",
    associate: "3",
    mid: "4",
    senior: "4",
    "mid-senior": "4",
    "mid-senior-level": "4",
    director: "5",
    executive: "6",
  };
  const JOB_TYPES = {
    "full-time": "F",
    fulltime: "F",
    full: "F",
    "part-time": "P",
    parttime: "P",
    part: "P",
    contract: "C",
    temporary: "T",
    temp: "T",
    volunteer: "V",
    internship: "I",
    other: "O",
  };
  const DATE_POSTED = {
    any: "on",
    month: "r2592000",
    "past-month": "r2592000",
    week: "r604800",
    "past-week": "r604800",
    day: "r86400",
    "24h": "r86400",
    "past-24h": "r86400",
  };
  const REMOTE_TYPES = {
    onsite: "1",
    "on-site": "1",
    hybrid: "3",
    remote: "2",
  };

  const parseCsvArg = (value) => {
    if (value === undefined || value === null || value === "") return [];
    return String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const mapFilterValues = (input, mapping, label) => {
    const values = parseCsvArg(input);
    const resolved = values.map((value) => {
      const mapped = mapping[String(value).toLowerCase()];
      if (!mapped) throw new Error(`Unsupported ${label}: ${value}`);
      return mapped;
    });
    return Array.from(new Set(resolved));
  };

  const buildVoyagerSearchQuery = (input) => {
    const hasFilters =
      input.companyIds.length ||
      input.experienceLevels.length ||
      input.jobTypes.length ||
      input.datePostedValues.length ||
      input.remoteTypes.length;
    const parts = [
      "origin:" + (hasFilters ? "JOB_SEARCH_PAGE_JOB_FILTER" : "JOB_SEARCH_PAGE_OTHER_ENTRY"),
      "keywords:" + input.keywords,
    ];
    if (input.location) {
      parts.push("locationUnion:(seoLocation:(location:" + input.location + "))");
    }
    const filters = [];
    if (input.companyIds.length) filters.push("company:List(" + input.companyIds.join(",") + ")");
    if (input.experienceLevels.length) filters.push("experience:List(" + input.experienceLevels.join(",") + ")");
    if (input.jobTypes.length) filters.push("jobType:List(" + input.jobTypes.join(",") + ")");
    if (input.datePostedValues.length) filters.push("timePostedRange:List(" + input.datePostedValues.join(",") + ")");
    if (input.remoteTypes.length) filters.push("workplaceType:List(" + input.remoteTypes.join(",") + ")");
    if (filters.length) parts.push("selectedFilters:(" + filters.join(",") + ")");
    parts.push("spellCorrectionEnabled:true");
    return "(" + parts.join(",") + ")";
  };

  const buildVoyagerUrl = (input, offset, count) => {
    const params = new URLSearchParams({
      decorationId: "com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220",
      count: String(count),
      q: "jobSearch",
    });
    const query = encodeURIComponent(buildVoyagerSearchQuery(input))
      .replace(/%3A/gi, ":")
      .replace(/%2C/gi, ",")
      .replace(/%28/gi, "(")
      .replace(/%29/gi, ")");
    return `/voyager/api/voyagerJobsDashJobCards?${params.toString()}&query=${query}&start=${offset}`;
  };

  const keywords = String(__QUERY_JSON__ || "").trim();
  if (!keywords) throw new Error("query is required");
  if (__DETAILS__) throw new Error("linkedin details=true is not supported in gather script mode");

  const companyIds = parseCsvArg(__COMPANY_JSON__);
  const nonNumericCompanies = companyIds.filter((item) => !/^\d+$/.test(item));
  if (nonNumericCompanies.length) {
    throw new Error(`company must be LinkedIn numeric IDs in script mode: ${nonNumericCompanies.join(", ")}`);
  }

  const input = {
    keywords,
    location: String(__LOCATION_JSON__ || "").trim(),
    limit: Math.max(1, Math.min(__LIMIT__, 100)),
    start: Math.max(0, __START__ || 0),
    companyIds,
    experienceLevels: mapFilterValues(__EXPERIENCE_LEVEL_JSON__, EXPERIENCE_LEVELS, "experience_level"),
    jobTypes: mapFilterValues(__JOB_TYPE_JSON__, JOB_TYPES, "job_type"),
    datePostedValues: mapFilterValues(__DATE_POSTED_JSON__, DATE_POSTED, "date_posted"),
    remoteTypes: mapFilterValues(__REMOTE_JSON__, REMOTE_TYPES, "remote"),
  };

  const jsession = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("JSESSIONID="))
    ?.slice("JSESSIONID=".length);
  if (!jsession) {
    throw new Error("LinkedIn JSESSIONID cookie not found. Please sign in first.");
  }
  const csrf = jsession.replace(/^"|"$/g, "");

  const allJobs = [];
  let offset = input.start;
  const maxBatch = 25;

  while (allJobs.length < input.limit) {
    const count = Math.min(maxBatch, input.limit - allJobs.length);
    const apiPath = buildVoyagerUrl(input, offset, count);
    const response = await fetch(apiPath, {
      credentials: "include",
      headers: {
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkedIn API error: HTTP ${response.status} ${text.slice(0, 120)}`);
    }
    const payload = await response.json();
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    if (!elements.length) break;

    for (const element of elements) {
      const card = element?.jobCardUnion?.jobPostingCard;
      if (!card) continue;
      const jobId = [card.jobPostingUrn, card.jobPosting?.entityUrn, card.entityUrn]
        .filter(Boolean)
        .map((item) => String(item).match(/(\d+)/)?.[1])
        .find(Boolean);
      const listedItem = (card.footerItems || []).find((item) => item?.type === "LISTED_DATE" && item?.timeAt);
      const listed = listedItem?.timeAt ? new Date(listedItem.timeAt).toISOString().slice(0, 10) : "";
      allJobs.push({
        title: card.jobPostingTitle || card.title?.text || "",
        company: card.primaryDescription?.text || "",
        location: card.secondaryDescription?.text || "",
        listed,
        salary: card.tertiaryDescription?.text || "",
        url: jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : "",
      });
    }

    if (elements.length < count) break;
    offset += elements.length;
  }

  const jobs = allJobs.slice(0, __COUNT__).map((item, index) => ({
    rank: input.start + index + 1,
    ...item,
  }));

  return {
    query: keywords,
    location: input.location,
    count: jobs.length,
    jobs,
  };
};

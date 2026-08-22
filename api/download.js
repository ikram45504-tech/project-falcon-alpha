export default async function handler(req, res) {
  const { tag, asset } = req.query;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const repo = "ikram45504-tech/travel-accounting";

  if (!tag || !asset) {
    return res.status(400).send("Missing tag or asset parameter");
  }

  try {
    // 1. Fetch release info to find asset ID
    const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Vercel-Updater",
      },
    });

    if (!releaseRes.ok) {
      return res.status(404).send("Release not found");
    }

    const release = await releaseRes.json();

    // 2. Find specific asset
    const targetAsset = release.assets.find((a) => a.name === asset);
    if (!targetAsset) {
      return res.status(404).send("Asset not found in this release");
    }

    // 3. Request download from GitHub API (but don't follow redirect)
    const downloadRes = await fetch(targetAsset.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/octet-stream",
        "User-Agent": "Vercel-Updater",
      },
      redirect: "manual",
    });

    // GitHub returns 302 Found with a Location header pointing to AWS S3
    if (downloadRes.status === 302 || downloadRes.status === 301) {
      const s3Url = downloadRes.headers.get("location");
      // Redirect the user directly to the S3 URL to download the file!
      return res.redirect(302, s3Url);
    } else {
      return res.status(500).send("Expected redirect from GitHub, got " + downloadRes.status);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

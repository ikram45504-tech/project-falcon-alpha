export default async function handler(req, res) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const repo = "ikram45504-tech/travel-accounting";

  try {
    // 1. Fetch latest release info
    const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Vercel-Updater",
      },
    });

    if (!releaseRes.ok) {
      const text = await releaseRes.text();
      return res
        .status(400)
        .json({ error: "GitHub API failed", status: releaseRes.status, body: text, token_exists: !!GITHUB_TOKEN });
    }

    const release = await releaseRes.json();

    // 2. Find latest.json asset
    const latestJsonAsset = release.assets.find((a) => a.name === "latest.json");
    if (!latestJsonAsset) {
      return res.status(400).json({ error: "latest.json missing", assets: release.assets.map((a) => a.name) });
    }

    // 3. Fetch latest.json content
    const jsonContentRes = await fetch(latestJsonAsset.url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/octet-stream",
        "User-Agent": "Vercel-Updater",
      },
    });

    if (!jsonContentRes.ok) {
      const text = await jsonContentRes.text();
      return res
        .status(400)
        .json({ error: "Failed to fetch latest.json content", status: jsonContentRes.status, body: text });
    }

    const updateData = await jsonContentRes.json();

    // 4. Rewrite URLs to point to our secure download proxy
    const host = req.headers.host;
    const protocol = host.includes("localhost") ? "http" : "https";

    if (updateData.platforms) {
      for (const [platform, data] of Object.entries(updateData.platforms)) {
        // Parse original GitHub URL to grab the file name
        const urlParts = data.url.split("/");
        const assetName = urlParts[urlParts.length - 1];
        const tag = release.tag_name;

        // Rewrite the URL to our secure Vercel proxy
        data.url = `${protocol}://${host}/api/download?tag=${tag}&asset=${assetName}`;
      }
    }

    res.status(200).json(updateData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

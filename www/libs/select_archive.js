// 渲染存档卡片并在点击时跳转到 chat_page.html?id=<archive_id>
function safeLoadArchives() {
  try {
    const raw = localStorage.getItem("archive");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("读取存档失败", e);
    return [];
  }
}

function renderArchives() {
  const archives = safeLoadArchives();
  const grid =
    document.getElementById("grid") || document.getElementById("archive_list");
  if (!grid) {
    console.warn("未找到存档容器 (#grid 或 #archive_list)");
    return;
  }
  grid.innerHTML = "";

  if (archives.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无存档";
    grid.appendChild(empty);
    return;
  }

  archives.forEach((item) => {
    const card = document.createElement("div");
    card.className = "card archive_card";
    card.setAttribute("data-archive-id", item.archive_id);

    const title = document.createElement("h3");
    title.textContent = item.archive_name || "未命名存档";
    card.appendChild(title);

    const desc = document.createElement("p");
    desc.textContent = item.archive_description || "";
    card.appendChild(desc);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = item.archive_id
      ? new Date(Number(item.archive_id)).toLocaleString()
      : "";
    card.appendChild(meta);

    // 点击卡片直接跳转到聊天页面，URL 带上 id 参数
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-archive-id");
      if (id) {
        // 相对路径跳转到 html 目录下的 chat_page.html
        window.location.href = `chat_page.html?id=${encodeURIComponent(id)}`;
      }
    });

    grid.appendChild(card);
  });
}

// 当页面加载完成时渲染存档
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderArchives);
} else {
  renderArchives();
}

// 对外暴露一个刷新函数（如果其他脚本需要）
window.renderArchives = renderArchives;

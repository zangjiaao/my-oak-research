"""
Export browser authentication data for web platforms.

Supports flexible authentication type combinations:
- cookie: Export cookies from Chrome
- localstorage: Export localStorage via browser console script
- profile: Full browser profile via Playwright persistent context

Usage:
    uv run export_chrome_cookies.py telegram
    uv run export_chrome_cookies.py whatsapp
    uv run export_chrome_cookies.py x
    uv run export_chrome_cookies.py linkedin
    uv run export_chrome_cookies.py youtube
    uv run export_chrome_cookies.py zhihu
    uv run export_chrome_cookies.py bilibili
    uv run export_chrome_cookies.py --help

Requirements:
    uv sync

Files are saved to .auth/ directory (gitignored by default).
"""

import os
import sys
import json
import argparse
import asyncio
import browser_cookie3
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
AUTH_DIR = SCRIPT_DIR / ".auth"

# Authentication types (can be combined as array):
# - cookie: Export cookies from Chrome
# - localstorage: Export localStorage via browser console script
# - profile: Full browser profile (uses Playwright persistent context)
PLATFORMS = {
    # === Existing platforms (cookie only) ===
    "x": {
        "domains": [".x.com", ".twitter.com"],
        "url": "https://x.com",
        "output_file": "x_auth.json",
        "display_name": "X.com (Twitter)",
        "auth_types": ["cookie"],
    },
    "twitter": {
        "domains": [".x.com", ".twitter.com"],
        "url": "https://x.com",
        "output_file": "x_auth.json",
        "display_name": "X.com (Twitter)",
        "auth_types": ["cookie"],
    },
    "xiaohongshu": {
        "domains": [".xiaohongshu.com"],
        "url": "https://www.xiaohongshu.com",
        "output_file": "xiaohongshu_auth.json",
        "display_name": "小红书 (Xiaohongshu)",
        "auth_types": ["cookie"],
    },
    "xhs": {
        "domains": [".xiaohongshu.com"],
        "url": "https://www.xiaohongshu.com",
        "output_file": "xiaohongshu_auth.json",
        "display_name": "小红书 (Xiaohongshu)",
        "auth_types": ["cookie"],
    },
    "reddit": {
        "domains": [".reddit.com"],
        "url": "https://www.reddit.com",
        "output_file": "reddit_auth.json",
        "display_name": "Reddit",
        "auth_types": ["cookie"],
    },
    "douyin": {
        "domains": [".douyin.com"],
        "url": "https://www.douyin.com",
        "output_file": "douyin_auth.json",
        "display_name": "抖音 (Douyin)",
        "auth_types": ["cookie"],
    },
    "tiktok": {
        "domains": [".tiktok.com"],
        "url": "https://www.tiktok.com",
        "output_file": "tiktok_auth.json",
        "display_name": "TikTok",
        "auth_types": ["cookie"],
    },
    "weibo": {
        "domains": [".weibo.com", ".weibo.cn"],
        "url": "https://weibo.com",
        "output_file": "weibo_auth.json",
        "display_name": "微博 (Weibo)",
        "auth_types": ["cookie"],
    },
    # === New platforms with special auth types ===
    "telegram": {
        "domains": [".telegram.org", ".web.telegram.org"],
        "url": "https://web.telegram.org/a/",
        "output_file": "telegram_auth.json",
        "display_name": "Telegram Web",
        "auth_types": ["cookie", "localstorage"],
    },
    "whatsapp": {
        "domains": [".whatsapp.com", ".web.whatsapp.com"],
        "url": "https://web.whatsapp.com",
        "output_file": "whatsapp_auth.json",
        "display_name": "WhatsApp Web",
        "auth_types": ["profile"],
        "profile_dir": "whatsapp_profile",
    },
    "instagram": {
        "domains": [".instagram.com"],
        "url": "https://www.instagram.com",
        "output_file": "instagram_auth.json",
        "display_name": "Instagram",
        "auth_types": ["cookie"],
    },
    "facebook": {
        "domains": [".facebook.com"],
        "url": "https://www.facebook.com",
        "output_file": "facebook_auth.json",
        "display_name": "Facebook",
        "auth_types": ["cookie"],
    },
    "linkedin": {
        "domains": [".linkedin.com"],
        "url": "https://www.linkedin.com",
        "output_file": "linkedin_auth.json",
        "display_name": "LinkedIn",
        "auth_types": ["cookie"],
    },
    "youtube": {
        "domains": [".youtube.com"],
        "url": "https://www.youtube.com",
        "output_file": "youtube_auth.json",
        "display_name": "YouTube",
        "auth_types": ["cookie"],
    },
    "zhihu": {
        "domains": [".zhihu.com"],
        "url": "https://www.zhihu.com",
        "output_file": "zhihu_auth.json",
        "display_name": "知乎 (Zhihu)",
        "auth_types": ["cookie"],
    },
    "bilibili": {
        "domains": [".bilibili.com"],
        "url": "https://www.bilibili.com",
        "output_file": "bilibili_auth.json",
        "display_name": "Bilibili",
        "auth_types": ["cookie"],
    },
}


def export_cookies(platform_config: dict) -> list:
    """Export cookies from Chrome for specified domains."""
    all_cookies = []

    print(f"正在导出 cookies...")
    print(f"目标域名: {', '.join(platform_config['domains'])}")

    try:
        for domain in platform_config["domains"]:
            try:
                chrome_cookies = browser_cookie3.chrome(domain_name=domain)

                for cookie in chrome_cookies:
                    pw_cookie = {
                        "name": cookie.name,
                        "value": cookie.value,
                        "domain": cookie.domain,
                        "path": cookie.path,
                        "secure": bool(cookie.secure),
                        "httpOnly": bool(cookie.has_nonstandard_attr("HttpOnly")),
                        "sameSite": "Lax",
                    }

                    if cookie.expires:
                        pw_cookie["expires"] = float(cookie.expires)

                    all_cookies.append(pw_cookie)

            except Exception as e:
                print(f"  警告: 无法获取域名 {domain} 的 cookies: {e}")
                continue

    except Exception as e:
        print(f"❌ 导出失败: {e}")
        print("提示：请完全关闭 Chrome 后再试")
        return []

    # Remove duplicates
    seen = set()
    unique_cookies = []
    for cookie in all_cookies:
        key = (cookie["name"], cookie["domain"])
        if key not in seen:
            seen.add(key)
            unique_cookies.append(cookie)

    return unique_cookies


def generate_localstorage_script(platform: str, url: str) -> str:
    """Generate JavaScript code to extract localStorage."""
    return f"""
// ============================================================
// localStorage 导出脚本 - {platform}
// ============================================================
//
// 使用方法：
// 1. 在 Chrome 中打开 {url}
// 2. 确保已登录
// 3. 按 F12 打开开发者工具
// 4. 切换到 Console 标签
// 5. 复制并粘贴下面的代码，按回车执行
// 6. 复制输出的完整 JSON 数据
// 7. 保存到对应的 _storage_data.json 文件中
//
// ============================================================

(function() {{
    const result = {{
        localStorage: {{}},
        origin: window.location.origin,
        timestamp: new Date().toISOString()
    }};

    // 导出 localStorage
    console.log('📦 正在导出 localStorage...');
    for (let i = 0; i < localStorage.length; i++) {{
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        result.localStorage[key] = value;
    }}
    console.log(`✅ localStorage 导出完成: ${{Object.keys(result.localStorage).length}} 项`);

    // 输出结果
    console.log('\\n========== 导出完成 ==========');
    console.log(`localStorage: ${{Object.keys(result.localStorage).length}} 项`);
    console.log('\\n📄 JSON 数据:');
    console.log(JSON.stringify(result, null, 2));
    console.log('================================');

    // 复制到剪贴板
    navigator.clipboard.writeText(JSON.stringify(result)).then(() => {{
        console.log('\\n✅ 已复制到剪贴板！');
    }}).catch(err => {{
        console.error('复制失败:', err);
    }});

    return result;
}})();
"""


async def export_profile(platform: str, config: dict) -> bool:
    """Export authentication using Playwright persistent context."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("❌ 需要安装 playwright: uv add playwright && uv run playwright install chromium")
        return False

    profile_dir = AUTH_DIR / config.get("profile_dir", f"{platform}_profile")
    profile_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n使用持久化浏览器配置文件模式")
    print(f"配置文件位置: {profile_dir}")
    print(f"\n{'='*60}")
    print(f"首次运行需要手动登录（如扫描 QR 码）")
    print(f"登录成功后，配置文件会自动保存")
    print(f"后续运行将自动使用保存的登录状态")
    print(f"{'='*60}\n")

    async with async_playwright() as p:
        print("启动浏览器...")

        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
            ]
        )

        page = context.pages[0] if context.pages else await context.new_page()

        print(f"访问: {config['url']}")
        await page.goto(config['url'], wait_until='networkidle', timeout=60000)

        print("\n" + "="*60)
        print("🔄 浏览器已打开，请手动完成登录")
        print("   登录成功后按 Ctrl+C 保存配置并退出")
        print("="*60 + "\n")

        try:
            await asyncio.sleep(3600)  # Keep open for 1 hour
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass  # User pressed Ctrl+C
        
        print("\n正在保存配置并关闭浏览器...")
        
        try:
            await context.close()
        except Exception:
            pass  # Browser might already be closed

    print(f"\n✅ 配置文件已保存到: {profile_dir}")
    print(f"   后续可直接使用此配置验证登录状态")

    return True


def export_platform(platform: str) -> bool:
    """Export authentication data for a platform based on its auth types."""
    platform_lower = platform.lower()

    if platform_lower not in PLATFORMS:
        print(f"❌ 未知平台: '{platform}'")
        print(f"支持的平台: {', '.join(sorted(set(PLATFORMS.keys())))}")
        return False

    config = PLATFORMS[platform_lower]
    auth_types = config.get("auth_types", ["cookie"])

    AUTH_DIR.mkdir(exist_ok=True)

    # Display header
    auth_type_names = {
        "cookie": "Cookie",
        "localstorage": "localStorage",
        "profile": "持久化配置文件"
    }
    type_display = " + ".join(auth_type_names.get(t, t) for t in auth_types)

    print(f"\n{'='*60}")
    print(f"正在导出 {config['display_name']} 认证数据")
    print(f"认证类型: {type_display}")
    print(f"{'='*60}\n")

    # Handle profile type (exclusive - cannot combine with others)
    if "profile" in auth_types:
        try:
            return asyncio.run(export_profile(platform_lower, config))
        except KeyboardInterrupt:
            print("\n\n✅ 配置已保存")
            return True

    # Handle cookie + localstorage combinations
    output_path = AUTH_DIR / config["output_file"]
    storage_state = {
        "cookies": [],
        "origins": []
    }

    # Export cookies if needed
    if "cookie" in auth_types:
        cookies = export_cookies(config)

        if not cookies:
            print(f"⚠️  未找到 {config['display_name']} 的 cookies")
            print("请确保：")
            print("  1. 已在 Chrome 中登录该平台")
            print("  2. Chrome 已完全关闭\n")
        else:
            print(f"✅ 成功导出 {len(cookies)} 个 cookies\n")
            storage_state["cookies"] = cookies

    # Handle localStorage if needed
    if "localstorage" in auth_types:
        print(f"⚠️  {config['display_name']} 需要 localStorage 数据\n")
        print(f"请按以下步骤操作：\n")
        print(f"{'='*60}")
        print(f"1. 在 Chrome 中打开: {config['url']}")
        print(f"2. 确保已登录")
        print(f"3. 按 F12 打开开发者工具")
        print(f"4. 切换到 Console 标签")
        print(f"5. 复制并执行脚本（已保存到 .auth/{platform_lower}_storage_script.js）")
        print(f"6. 将复制的 JSON 保存到 .auth/{platform_lower}_storage_data.json")
        print(f"7. 重新运行此脚本以合并数据")
        print(f"{'='*60}\n")

        # Save the script
        script_path = AUTH_DIR / f"{platform_lower}_storage_script.js"
        script_content = generate_localstorage_script(config['display_name'], config['url'])

        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script_content)

        print(f"JavaScript 脚本已保存到: {script_path}\n")

        # Check if storage data file exists
        storage_path = AUTH_DIR / f"{platform_lower}_storage_data.json"
        if storage_path.exists():
            print(f"✅ 发现已有的存储数据: {storage_path}")
            try:
                with open(storage_path, "r", encoding="utf-8") as f:
                    storage_data = json.load(f)

                # Prepare origins data
                origins_data = {
                    "origin": storage_data.get("origin", config["url"]),
                    "localStorage": []
                }

                # Process localStorage
                if "localStorage" in storage_data:
                    ls_data = storage_data["localStorage"]
                    origins_data["localStorage"] = [
                        {"name": k, "value": v}
                        for k, v in ls_data.items()
                    ]
                    print(f"✅ localStorage 数据已合并: {len(ls_data)} 项")

                storage_state["origins"] = [origins_data]
                print("✅ 存储数据合并完成\n")

            except Exception as e:
                print(f"⚠️  读取存储数据失败: {e}\n")
        else:
            print(f"ℹ️  等待存储数据...")
            print(f"   完成后重新运行此脚本以合并数据\n")

    # Save storage state
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(storage_state, f, indent=2, ensure_ascii=False)

    print(f"{'='*60}")
    print(f"✅ 认证数据已保存到: {output_path}")
    print(f"{'='*60}\n")

    return True


def main():
    # Get unique platform names (excluding aliases like 'twitter', 'xhs')
    unique_platforms = sorted(set(
        k for k in PLATFORMS.keys() 
        if k not in ['twitter', 'xhs']  # Exclude aliases
    ))
    
    parser = argparse.ArgumentParser(
        description="导出浏览器认证数据",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
支持的平台及认证类型:
  x, twitter    - 仅 Cookie
  xiaohongshu   - 仅 Cookie  
  reddit        - 仅 Cookie
  douyin        - 仅 Cookie
  tiktok        - 仅 Cookie
  weibo         - 仅 Cookie
  linkedin      - 仅 Cookie
  youtube       - 仅 Cookie
  zhihu         - 仅 Cookie
  bilibili      - 仅 Cookie
  telegram      - Cookie + localStorage
  whatsapp      - 持久化浏览器配置文件（需要 Playwright）

认证类型说明:
  cookie      - 从 Chrome 导出 cookies（需关闭 Chrome）
  localstorage - 通过浏览器控制台脚本导出 localStorage
  profile     - 使用 Playwright 持久化配置文件（保存完整浏览器状态）

示例:
  uv run export_chrome_cookies.py x          # 仅导出 Cookie
  uv run export_chrome_cookies.py telegram   # 导出 Cookie，生成 localStorage 脚本
  uv run export_chrome_cookies.py whatsapp   # 启动浏览器，手动登录后保存配置

注意:
  1. 大多数平台: 运行前请完全关闭 Chrome 浏览器
  2. whatsapp: 首次运行需要扫描 QR 码，登录后按 Ctrl+C 保存
  3. telegram: 需要额外手动导出 localStorage 数据
        """
    )

    parser.add_argument(
        "platform",
        type=str,
        help="要导出认证数据的平台"
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="自定义输出文件名 (默认根据平台自动生成)"
    )

    args = parser.parse_args()

    success = export_platform(args.platform)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

"""
Export Chrome cookies for social media platforms in Playwright storage_state format.
Supports: X.com, Xiaohongshu, Telegram, Reddit, Douyin, etc.

Usage:
    uv run export_chrome_cookies.py x          # Export X.com cookies
    uv run export_chrome_cookies.py xiaohongshu # Export Xiaohongshu cookies
    uv run export_chrome_cookies.py --help      # Show help

Files are saved to .auth/ directory (gitignored by default).
"""
import os
import sys
import json
import argparse
import browser_cookie3
from pathlib import Path

# Auth files directory (relative to script location)
SCRIPT_DIR = Path(__file__).parent
AUTH_DIR = SCRIPT_DIR / ".auth"

# Platform configurations
PLATFORMS = {
    "x": {
        "domains": [".x.com", ".twitter.com"],
        "output_file": "x_auth.json",
        "display_name": "X.com (Twitter)",
    },
    "twitter": {
        "domains": [".x.com", ".twitter.com"],
        "output_file": "x_auth.json",
        "display_name": "X.com (Twitter)",
    },
    "xiaohongshu": {
        "domains": [".xiaohongshu.com"],
        "output_file": "xiaohongshu_auth.json",
        "display_name": "小红书 (Xiaohongshu)",
    },
    "xhs": {
        "domains": [".xiaohongshu.com"],
        "output_file": "xiaohongshu_auth.json",
        "display_name": "小红书 (Xiaohongshu)",
    },
    "telegram": {
        "domains": [".telegram.org", ".web.telegram.org"],
        "output_file": "telegram_auth.json",
        "display_name": "Telegram Web",
    },
    "reddit": {
        "domains": [".reddit.com"],
        "output_file": "reddit_auth.json",
        "display_name": "Reddit",
    },
    "douyin": {
        "domains": [".douyin.com"],
        "output_file": "douyin_auth.json",
        "display_name": "抖音 (Douyin)",
    },
    "tiktok": {
        "domains": [".tiktok.com"],
        "output_file": "tiktok_auth.json",
        "display_name": "TikTok",
    },
}


def export_cookies(platform: str, output_file: str = None):
    """
    Export cookies from Chrome for the specified platform.
    
    Args:
        platform: Platform name (x, xiaohongshu, telegram, reddit)
        output_file: Optional custom output file name
    """
    platform_lower = platform.lower()
    
    if platform_lower not in PLATFORMS:
        print(f"Error: Unknown platform '{platform}'")
        print(f"Supported platforms: {', '.join(PLATFORMS.keys())}")
        return False
    
    config = PLATFORMS[platform_lower]
    
    # Ensure .auth directory exists
    AUTH_DIR.mkdir(exist_ok=True)
    
    # Determine output path
    if output_file:
        # If custom path provided, use it as-is if absolute, otherwise put in .auth
        output = Path(output_file)
        if not output.is_absolute():
            output = AUTH_DIR / output_file
    else:
        output = AUTH_DIR / config["output_file"]
    
    print(f"正在从 Chrome 导出 {config['display_name']} cookies...")
    print(f"目标域名: {', '.join(config['domains'])}")
    
    all_pw_cookies = []
    
    try:
        for domain in config["domains"]:
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
                    
                    # Handle expiration time
                    if cookie.expires:
                        pw_cookie["expires"] = float(cookie.expires)
                    
                    all_pw_cookies.append(pw_cookie)
                    
            except Exception as e:
                print(f"Warning: Could not get cookies for domain {domain}: {e}")
                continue
    
    except Exception as e:
        print(f"导出失败: {e}")
        print("提示：可能需要完全关闭 Chrome 后再试")
        return False
    
    if not all_pw_cookies:
        print(f"未找到 {config['display_name']} 的 cookies")
        print("请确保已在 Chrome 中登录该平台")
        return False
    
    # Remove duplicates (same name + domain)
    seen = set()
    unique_cookies = []
    for cookie in all_pw_cookies:
        key = (cookie["name"], cookie["domain"])
        if key not in seen:
            seen.add(key)
            unique_cookies.append(cookie)
    
    # Create Playwright storage state format
    storage_state = {
        "cookies": unique_cookies,
        "origins": []
    }
    
    with open(output, "w", encoding="utf-8") as f:
        json.dump(storage_state, f, indent=2, ensure_ascii=False)
    
    print(f"成功导出 {len(unique_cookies)} 个 cookies 到 {output}")
    print(f"\n下一步：将 {output} 文件上传到系统中进行验证")
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="导出 Chrome cookies 为 Playwright 可用格式",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
支持的平台:
  x, twitter      - X.com (Twitter)
  xiaohongshu, xhs - 小红书
  telegram        - Telegram Web
  reddit          - Reddit

示例:
  python export_chrome_cookies.py x
  python export_chrome_cookies.py xiaohongshu --output my_xhs_cookies.json
  
注意:
  运行此脚本之前，请确保已完全关闭 Chrome 浏览器。
  如果遇到权限问题，可能需要使用管理员权限运行。
        """
    )
    
    parser.add_argument(
        "platform",
        type=str,
        help="要导出 cookies 的平台名称"
    )
    
    parser.add_argument(
        "--output", "-o",
        type=str,
        default=None,
        help="自定义输出文件名 (默认根据平台自动生成)"
    )
    
    args = parser.parse_args()
    
    success = export_cookies(args.platform, args.output)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

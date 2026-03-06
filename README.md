<p align="center">
  <img src="logo.png" alt="JellyTags Logo" width="150" />
</p>

# JellyTags
JellyTags is a lightweight, responsive web application for managing tags within your Jellyfin media library. Easily select multiple movies or shows and batch-apply tags.

![Screenshot](docs/screenshot.png)

## Features
- **Batch Editing:** Select multiple media items and apply tags to all of them at once.
- **Tag Suggestions:** View existing tags across your selection and easily propose new or current ones.
- **Responsive Design:** A mobile-friendly sliding sidebar allows you to manage tags on the go.
- **Sorting & Filtering:** Find specific media quickly using the built-in search bar and sorting dropdown.

## Requirements
- A [Jellyfin](https://jellyfin.org/) server.
- An API Token from your Jellyfin server with **Administrator** privileges (needed to fetch the admin user's library context and update items).

## Running via Docker (Recommended)
You can easily spin up the JellyTags interface using Docker and Docker Compose. Environment variables are substituted at runtime.

### 1. Create a `docker-compose.yml`
Create a `docker-compose.yml` file anywhere on your server, or clone this repository and modify the existing one.

```yaml
services:
  jellytags:
    build: . # or use an image if published
    container_name: jellytags
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - VITE_JELLYFIN_URL=http://your-jellyfin-server-ip:8096
      - VITE_JELLYFIN_TOKEN=your_admin_api_token
```

### 2. Start the container
Run the following command:
```bash
docker-compose up -d
```
Access the interface at `http://localhost:8080`.

## Installation (Local Development)

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/jellytags.git
cd jellytags
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Variables
To run JellyTags locally, create a `.env` file at the root of the project:
```env
VITE_JELLYFIN_URL=http://localhost:8096
VITE_JELLYFIN_TOKEN=your_admin_api_token
```

### 4. Start the Development Server
```bash
npm run dev
```

## Support / Sponsor
If you found this tool useful, consider buying me a coffee!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/christt105)

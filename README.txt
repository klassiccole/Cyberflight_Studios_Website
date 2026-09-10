# Cyberflight Studios Website

Official website for **Cyberflight Studios LLC**, a photography, videography, drone media, and creative studio based in Charlotte, North Carolina.

## Website

**cyberflight.studio**

## About the Project

This repository contains the source code and web assets for the Cyberflight Studios website.

The site is built as a lightweight static website using HTML, CSS, and JavaScript. It is maintained through GitHub and currently hosted using GitHub Pages.

The website originally began with the **Dimension** template by HTML5 UP but has since been substantially restructured and customized for Cyberflight Studios. The original single-page, hash-based layout has been replaced with a multi-page architecture using dedicated URLs for improved navigation, maintainability, performance, and search engine indexing.

## Services

Cyberflight Studios provides creative media services including:

- Photography
- Videography
- Drone Photography & Videography
- FPV Drone Media
- Event Coverage
- Portraits
- Business & Promotional Media
- Creative Projects
- Visual Drone Inspections

Dedicated service pages provide additional information about Photography, Videography, and Drone Services.

## Gallery

The website includes dedicated photography galleries organized into categories such as:

- Events
- Charlotte
- Nature
- Film Photography

Event galleries may contain additional individual collections for specific events and projects.

## Site Structure

The website uses dedicated directories and `index.html` files to provide clean URLs.

Example structure:

```text
/
├── about/
├── contact/
├── gallery/
│   ├── events/
│   ├── charlotte/
│   ├── nature/
│   └── film/
├── services/
│   ├── photography/
│   ├── videography/
│   └── drone/
├── assets/
│   ├── css/
│   └── js/
├── images/
└── videos/
```

This structure allows pages to use clean URLs such as:

```text
cyberflight.studio/about/
cyberflight.studio/gallery/
cyberflight.studio/services/
cyberflight.studio/services/drone/
```

## Features

### Multi-Page Architecture

The original Dimension single-page article system has been replaced with independent pages and dedicated URLs while maintaining a consistent visual design throughout the site.

### Smooth Page Transitions

Site-wide JavaScript provides fade-out and fade-in transitions between internal pages, helping hide document and background-video reloads while maintaining normal browser navigation and dedicated URLs.

### Navigation

Standalone pages include:

- Browser-history-based Back navigation
- A global Home button
- Smooth transitions during internal navigation
- Support for browser back/forward cache restoration

The Back button returns visitors to the page they previously viewed, while the Home button provides a direct route back to the main Cyberflight Studios landing page.

### Responsive Design

The site is designed for desktop, tablet, and mobile displays using responsive CSS and media queries.

### Background Video

Cyberflight Studios uses video backgrounds with static poster images as fallbacks.

Background videos are loaded in a way that prioritizes initial page rendering and provides a smooth visual experience while media loads.

The multi-page architecture also allows different background videos to be assigned to individual pages in the future.

### Media Optimization

The website uses optimized media formats and loading techniques where appropriate, including:

- WebP images
- Responsive image sizing
- Lazy loading for non-critical media
- Asynchronous image decoding
- Video poster images
- Deferred background-video loading

### Contact Form

The Contact page includes a custom contact form protected by **Cloudflare Turnstile** for spam and bot protection.

Form submissions are processed through Cyberflight Studios' Cloudflare-based form endpoint while the website itself remains hosted through GitHub Pages.

### Search Engine Optimization

Individual pages include dedicated:

- Page titles
- Meta descriptions
- Semantic page structure
- Descriptive image alt text
- Clean URLs

The multi-page architecture allows individual services, galleries, and other sections of the website to be independently indexed by search engines.

## Technologies

The website primarily uses:

- HTML5
- CSS3
- Vanilla JavaScript
- Font Awesome
- Git & GitHub
- GitHub Pages
- Cloudflare Turnstile
- Cloudflare-based form handling

The site intentionally avoids large JavaScript frameworks and unnecessary frontend dependencies to keep the website lightweight and maintainable.

## Development

Changes are developed and tested locally before being committed to the GitHub repository.

The website can be tested locally using a development server such as VS Code Live Server.

Typical Git workflow:

```bash
git add .
git commit -m "Describe changes"
git push origin main
```

Updates pushed to the production branch are deployed through GitHub Pages.

## Current Development

The website is actively maintained and expanded as Cyberflight Studios grows.

Current and future development includes:

- Expanding individual service pages
- Adding new photography and media galleries
- Adding portfolio work from client projects
- Further performance optimization
- Continued SEO improvements
- Additional page-specific media and background video
- Continued refinement of navigation and user experience
- Potential future migration from GitHub Pages to Cloudflare Pages

## Credits

The original website design was based on **Dimension by HTML5 UP**.

**HTML5 UP**  
html5up.net

Original template released under the **Creative Commons Attribution 3.0 License**.

The template has since been substantially modified and restructured for Cyberflight Studios, but attribution is retained in accordance with the original license.

## Copyright

Website content, photography, video, branding, and original Cyberflight Studios code and modifications are © Cyberflight Studios LLC.

Third-party components and original template code remain subject to their respective licenses.
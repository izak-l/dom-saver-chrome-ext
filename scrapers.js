// scrapers.js
// Extension framework for page-specific scrapers

class ScraperRegistry {
  constructor() {
    this.scrapers = new Map();
  }

  register(scraper) {
    if (!scraper.id || !scraper.name || !scraper.urlPatterns || !scraper.extract) {
      throw new Error('Scraper must have id, name, urlPatterns, and extract function');
    }
    this.scrapers.set(scraper.id, scraper);
    console.log(`Registered scraper: ${scraper.name}`);
  }

  findMatchingScrapers(url) {
    const matches = [];
    for (const [id, scraper] of this.scrapers) {
      if (this.matchesUrl(scraper, url)) {
        matches.push(scraper);
      }
    }
    return matches;
  }

  matchesUrl(scraper, url) {
    return scraper.urlPatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return url.includes(pattern);
      }
      if (pattern instanceof RegExp) {
        return pattern.test(url);
      }
      return false;
    });
  }

  getScraper(id) {
    return this.scrapers.get(id);
  }

  getAllScrapers() {
    return Array.from(this.scrapers.values());
  }
}

// Global registry instance
const scraperRegistry = new ScraperRegistry();

// LinkedIn Company People Scraper
const linkedinCompanyScraper = {
  id: 'linkedin-company-people',
  name: 'LinkedIn Company People',
  description: 'Extract LinkedIn profile URLs from company people pages',
  urlPatterns: [
    /linkedin\.com\/company\/[^\/]+\/people/,
    'linkedin.com/company'
  ],
  
  extract: function(doc, pageUrl, pageTitle) {
    console.log('LinkedIn Company People scraper executing...');
    
    // Find all anchor tags with aria-label containing "View" and "profile"
    const profileData = [];
    const anchors = doc.querySelectorAll('a[aria-label*="View"][aria-label*="profile"]');
    
    anchors.forEach(anchor => {
      if (anchor.href) {
        // Truncate URL to remove query parameters
        const baseUrl = anchor.href.split('?')[0];
        if (baseUrl.includes('linkedin.com/in/')) {
          // Find the blurb text - it's in a sibling container
          let blurb = "";
          
          // The blurb is in the artdeco-entity-lockup__subtitle which is a sibling of the title containing the anchor
          const lockupContent = anchor.closest('.artdeco-entity-lockup__content');
          if (lockupContent) {
            const blurbElement = lockupContent.querySelector('.artdeco-entity-lockup__subtitle div.ember-view.lt-line-clamp.lt-line-clamp--multi-line[style="-webkit-line-clamp: 2"]');
            if (blurbElement) {
              blurb = blurbElement.textContent.trim();
            }
          }
          
          profileData.push({
            url: baseUrl,
            blurb: blurb || ""
          });
        }
      }
    });

    // Also look for profile links in different structures
    const profileAnchors = doc.querySelectorAll('a[href*="/in/"]');
    profileAnchors.forEach(anchor => {
      if (anchor.href && anchor.href.includes('linkedin.com/in/')) {
        const baseUrl = anchor.href.split('?')[0];
        
        // Check if we already have this profile
        const existingProfile = profileData.find(p => p.url === baseUrl);
        if (!existingProfile) {
          // Find blurb for this profile link too
          let blurb = "";
          
          const lockupContent = anchor.closest('.artdeco-entity-lockup__content');
          if (lockupContent) {
            const blurbElement = lockupContent.querySelector('.artdeco-entity-lockup__subtitle div.ember-view.lt-line-clamp.lt-line-clamp--multi-line[style="-webkit-line-clamp: 2"]');
            if (blurbElement) {
              blurb = blurbElement.textContent.trim();
            }
          }
          
          profileData.push({
            url: baseUrl,
            blurb: blurb || ""
          });
        }
      }
    });

    // Remove duplicates based on URL and sort
    const uniqueProfiles = profileData.filter((profile, index, self) => 
      index === self.findIndex(p => p.url === profile.url)
    ).sort((a, b) => a.url.localeCompare(b.url));
    
    console.log(`Found ${uniqueProfiles.length} LinkedIn profiles with blurbs`);
    
    return {
      type: 'linkedin-profiles',
      data: uniqueProfiles,
      count: uniqueProfiles.length,
      extractedAt: new Date().toISOString(),
      pageUrl: pageUrl,
      pageTitle: pageTitle
    };
  }
};

// Register the LinkedIn scraper
scraperRegistry.register(linkedinCompanyScraper);

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScraperRegistry, scraperRegistry };
} else if (typeof window !== 'undefined') {
  // Browser environment
  window.scraperRegistry = scraperRegistry;
  window.ScraperRegistry = ScraperRegistry;
} else {
  // Service worker environment
  self.scraperRegistry = scraperRegistry;
  self.ScraperRegistry = ScraperRegistry;
}
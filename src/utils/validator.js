/**
 * Input Validator
 * Validates and sanitizes user inputs
 */

export default class Validator {
  /**
   * Validate URL
   * @param {string} url - URL to validate
   * @returns {boolean}
   */
  static isValidUrl(url) {
    try {
      const urlObject = new URL(url);
      return ['http:', 'https:'].includes(urlObject.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Validate phone number (basic validation)
   * @param {string} phone - Phone number
   * @returns {boolean}
   */
  static isValidPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 && cleaned.length <= 15;
  }

  /**
   * Validate email
   * @param {string} email - Email address
   * @returns {boolean}
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sanitize text (remove potentially harmful content)
   * @param {string} text - Text to sanitize
   * @returns {string}
   */
  static sanitizeText(text) {
    if (typeof text !== 'string') return '';
    
    // Remove null bytes
    let sanitized = text.replace(/\0/g, '');
    
    // Limit length
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }
    
    return sanitized.trim();
  }

  /**
   * Validate command arguments count
   * @param {Array} args - Command arguments
   * @param {number} min - Minimum required
   * @param {number} max - Maximum allowed (optional)
   * @returns {object} - { valid: boolean, message: string }
   */
  static validateArgsCount(args, min, max = Infinity) {
    if (args.length < min) {
      return {
        valid: false,
        message: `❌ Too few arguments. Minimum required: ${min}`
      };
    }
    
    if (args.length > max) {
      return {
        valid: false,
        message: `❌ Too many arguments. Maximum allowed: ${max}`
      };
    }
    
    return { valid: true, message: '' };
  }

  /**
   * Validate number in range
   * @param {string|number} value - Value to validate
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {object} - { valid: boolean, value: number, message: string }
   */
  static validateNumber(value, min = -Infinity, max = Infinity) {
    const num = Number(value);
    
    if (isNaN(num)) {
      return {
        valid: false,
        value: null,
        message: `❌ Invalid number: ${value}`
      };
    }
    
    if (num < min || num > max) {
      return {
        valid: false,
        value: num,
        message: `❌ Number must be between ${min} and ${max}`
      };
    }
    
    return {
      valid: true,
      value: num,
      message: ''
    };
  }

  /**
   * Validate integer
   * @param {string|number} value - Value to validate
   * @returns {object} - { valid: boolean, value: number, message: string }
   */
  static validateInteger(value) {
    const num = Number(value);
    
    if (isNaN(num) || !Number.isInteger(num)) {
      return {
        valid: false,
        value: null,
        message: `❌ Must be a whole number`
      };
    }
    
    return {
      valid: true,
      value: num,
      message: ''
    };
  }

  /**
   * Validate choice from list
   * @param {string} value - Value to validate
   * @param {Array} choices - Valid choices
   * @returns {object} - { valid: boolean, value: string, message: string }
   */
  static validateChoice(value, choices) {
    const lowerValue = value.toLowerCase();
    const lowerChoices = choices.map(c => c.toLowerCase());
    
    if (!lowerChoices.includes(lowerValue)) {
      return {
        valid: false,
        value: null,
        message: `❌ Invalid choice. Must be one of: ${choices.join(', ')}`
      };
    }
    
    // Return original case from choices
    const index = lowerChoices.indexOf(lowerValue);
    
    return {
      valid: true,
      value: choices[index],
      message: ''
    };
  }

  /**
   * Validate hex color code
   * @param {string} color - Color code
   * @returns {boolean}
   */
  static isValidHexColor(color) {
    return /^#([0-9A-F]{3}){1,2}$/i.test(color);
  }

  /**
   * Validate date string
   * @param {string} dateString - Date string
   * @returns {object} - { valid: boolean, date: Date, message: string }
   */
  static validateDate(dateString) {
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return {
        valid: false,
        date: null,
        message: `❌ Invalid date format`
      };
    }
    
    return {
      valid: true,
      date,
      message: ''
    };
  }

  /**
   * Check if string contains only alphanumeric characters
   * @param {string} str - String to check
   * @returns {boolean}
   */
  static isAlphanumeric(str) {
    return /^[a-zA-Z0-9]+$/.test(str);
  }

  /**
   * Validate username (alphanumeric, underscore, hyphen)
   * @param {string} username - Username to validate
   * @param {number} minLength - Minimum length
   * @param {number} maxLength - Maximum length
   * @returns {object}
   */
  static validateUsername(username, minLength = 3, maxLength = 20) {
    if (username.length < minLength || username.length > maxLength) {
      return {
        valid: false,
        message: `❌ Username must be ${minLength}-${maxLength} characters`
      };
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return {
        valid: false,
        message: `❌ Username can only contain letters, numbers, underscore, and hyphen`
      };
    }
    
    return {
      valid: true,
      message: ''
    };
  }

  /**
   * Validate mention format (@username or platform-specific)
   * @param {string} mention - Mention string
   * @param {string} platform - Platform name
   * @returns {object}
   */
  static validateMention(mention, platform) {
    if (platform === 'whatsapp') {
      // WhatsApp format: +1234567890 or 1234567890
      const cleaned = mention.replace(/[^\d]/g, '');
      return {
        valid: cleaned.length >= 10,
        value: cleaned,
        message: cleaned.length >= 10 ? '' : '❌ Invalid WhatsApp number'
      };
    }
    
    return {
      valid: false,
      message: '❌ Unsupported platform'
    };
  }

  /**
   * Escape special characters for regex
   * @param {string} str - String to escape
   * @returns {string}
   */
  static escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if string contains profanity (basic check)
   * @param {string} text - Text to check
   * @returns {boolean}
   */
  static containsProfanity(text) {
    // Basic profanity list - expand as needed
    const profanityList = ['badword1', 'badword2']; // Add actual words
    const lowerText = text.toLowerCase();
    
    return profanityList.some(word => lowerText.includes(word));
  }

  /**
   * Truncate text to max length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @param {string} suffix - Suffix to add if truncated
   * @returns {string}
   */
  static truncate(text, maxLength = 100, suffix = '...') {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Parse duration string (e.g., "5m", "2h", "1d")
   * @param {string} duration - Duration string
   * @returns {object} - { valid: boolean, milliseconds: number, message: string }
   */
  static parseDuration(duration) {
    const regex = /^(\d+)([smhd])$/;
    const match = duration.match(regex);
    
    if (!match) {
      return {
        valid: false,
        milliseconds: 0,
        message: '❌ Invalid duration format. Use: 5s, 5m, 2h, 1d'
      };
    }
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };
    
    return {
      valid: true,
      milliseconds: value * multipliers[unit],
      message: ''
    };
  }
}

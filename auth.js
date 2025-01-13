const jwt = require('jsonwebtoken');

/**
 * Verify a JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded token payload
 * @throws {Error} If token is invalid or verification fails
 */
const verifyToken = (token) => {
    // Validate environment setup
    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET environment variable is not set');
        throw new Error('JWT configuration error');
    }

    try {
        // Log basic token details for debugging
        console.log('Token Verification Attempt:', {
            tokenLength: token.length,
            tokenStart: token.substring(0, 20)
        });

        // Verify and decode the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Log successful verification details
        console.log('Token Decoded Successfully:', {
            userId: decoded.userId,
            username: decoded.username,
            expiresAt: new Date(decoded.exp * 1000).toISOString()
        });

        return decoded;
    } catch (error) {
        // Detailed logging of verification errors
        console.error('Token Verification Failed:', {
            name: error.name,
            message: error.message
        });

        // Throw specific error types
        if (error.name === 'TokenExpiredError') {
            throw new Error('Token has expired');
        }
        if (error.name === 'JsonWebTokenError') {
            throw new Error('Invalid token signature');
        }

        throw new Error('Token verification failed');
    }
};

/**
 * Generate a new JWT token
 * @param {Object} payload - User information to encode
 * @param {number} expiresIn - Token expiration time in seconds
 * @returns {string} Generated JWT token
 */
const generateToken = (payload, expiresIn = 86400) => {
    // Validate input
    if (!payload.userId || !payload.username) {
        throw new Error('Invalid token payload');
    }

    // Validate environment setup
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set');
    }

    try {
        const token = jwt.sign(
            {
                userId: payload.userId,
                username: payload.username
            }, 
            process.env.JWT_SECRET, 
            { 
                expiresIn 
            }
        );

        return token;
    } catch (error) {
        console.error('Token Generation Error:', error);
        throw new Error('Failed to generate token');
    }
};

module.exports = {
    verifyToken,
    generateToken
};
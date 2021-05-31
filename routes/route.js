const router = require('express').Router();

router.get('/', (req, res) => {
    return res.relativeSendFile('views/index.html');
})

module.exports = router;
<?php
/**
 * Réglages d'envoi des emails de FabEvent.
 * Copie ce fichier en « mail-config.php » à côté de mail.php sur l'hébergement, puis remplis-le.
 * Ne mets JAMAIS mail-config.php dans Git : il contient le mot de passe de la boîte mail.
 */
return [
    // adresse d'expédition : une boîte de ton domaine (les réponses vont à l'adresse de ta société, réglée dans FabEvent)
    'from' => 'fabevent@fabri.live',
    'fromName' => 'FABRI.live',
    // serveur SMTP de la boîte (recommandé). Sans ce bloc, la fonction mail() de l'hébergement est utilisée.
    'smtp' => [
        'host' => 'smtp.exemple.be',
        'port' => 587,          // 587 + 'tls' (STARTTLS), ou 465 + 'ssl'
        'secure' => 'tls',
        'user' => 'fabevent@fabri.live',
        'pass' => 'mot-de-passe-de-la-boite',
    ],
];

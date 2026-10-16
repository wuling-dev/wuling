import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import './style.css'
hydrateRoot(document, <StartClient />)

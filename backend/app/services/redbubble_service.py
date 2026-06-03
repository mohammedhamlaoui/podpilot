import logging
import time
from pathlib import Path
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, ElementNotInteractableException, StaleElementReferenceException
from selenium.webdriver.common.action_chains import ActionChains

from app.core.config import IMAGE_UPLOAD_DIR

logger = logging.getLogger(__name__)

def process_duplicate_upload(driver, template_id: str, image_filename: str, title: str, tags: str, description: str) -> bool:
    """
    Handles the 'Duplicate Settings' workflow for Redbubble.
    
    Args:
        driver: Selenium WebDriver instance.
        template_id: The ID of the Redbubble work to duplicate.
        image_filename: The filename of the image to upload (must exist in IMAGE_UPLOAD_DIR).
        title: The new title for the work.
        tags: The new tags for the work (comma separated).
        description: The new description for the work.
        
    Returns:
        bool: True if successful, False otherwise.
    """
    try:
        wait = WebDriverWait(driver, 30)

        # ==========================================
        # STEP 1: Initialization
        # ==========================================
        duplicate_url = f"https://www.redbubble.com/portfolio/images/{template_id}/duplicate"
        logger.info(f"Step 1: Navigating to {duplicate_url}")
        driver.get(duplicate_url)

        image_path = IMAGE_UPLOAD_DIR / image_filename
        if not image_path.exists():
            logger.error(f"Image not found at path: {image_path}")
            return False

        # Immediately inject the new image path
        file_input = wait.until(EC.presence_of_element_located((By.XPATH, "//input[@type='file']")))
        file_input.send_keys(str(image_path.resolve()))
        logger.info(f"Injected image: {image_path.name}")

        # ==========================================
        # STEP 2: The 'Watchdog' Phase (Crucial)
        # ==========================================
        logger.info("Step 2: Watchdog Phase - Monitoring upload progress...")
        
        # Give the DOM a tiny moment to register the upload and render the progress overlay
        time.sleep(1)
        
        upload_timeout = 120  # Max 2 minutes for an image upload
        start_time = time.time()
        
        # Clean while loop checking for the existence/visibility of the progress overlay
        while time.time() - start_time < upload_timeout:
            # Look for common Redbubble progress overlay classes
            progress_elements = driver.find_elements(By.CSS_SELECTOR, ".upload-progress, [class*='progress'], .circular-overlay")
            
            # If no progress elements are found, or none are visible, upload is likely done
            is_uploading = any(el.is_displayed() for el in progress_elements)
            
            if not is_uploading:
                logger.info("Upload progress overlay completely disappeared.")
                break
                
            time.sleep(2)
            
        if time.time() - start_time >= upload_timeout:
            logger.error("Watchdog Timeout: Image upload took too long. Refreshing.")
            driver.refresh()
            return False

        # Ensure image preview is visible before proceeding
        try:
            # Wait for the preview image to be fully visible
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".image-preview, .work-preview, img[src*='blob']")))
            logger.info("New image preview is fully visible.")
        except TimeoutException:
            logger.warning("Preview image took too long to load, continuing anyway...")

        # ==========================================
        # STEP 3: Metadata Injection (With Stale Element Retry & Fallback)
        # ==========================================
        logger.info("Step 3: Starting Metadata Injection.")
        
        def safe_fill_input(locator, text):
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    # Re-locate every time to avoid StaleElementReferenceException
                    element = wait.until(EC.element_to_be_clickable(locator))
                    element.clear()
                    element.send_keys(text)
                    return True
                except StaleElementReferenceException:
                    logger.warning(f"Stale element encountered for {locator}. Retrying...")
                    time.sleep(1)
                except Exception as e:
                    logger.warning(f"send_keys failed for {locator}, attempting JS Fallback. Error: {e}")
                    try:
                        # JavaScript Force (Fallback)
                        element = driver.find_element(*locator)
                        driver.execute_script("arguments[0].value = arguments[1];", element, text)
                        return True
                    except Exception as js_err:
                        logger.error(f"JS Fallback also failed: {js_err}")
                        if attempt == max_retries - 1:
                            raise
            return False

        # Title
        safe_fill_input((By.ID, "work_title_en"), title)

        # Description
        safe_fill_input((By.ID, "work_description_en"), description)

        # Tags - ActionChains Approach
        max_retries = 3
        for attempt in range(max_retries):
            try:
                # Re-locate explicitly
                tags_field = wait.until(EC.element_to_be_clickable((By.ID, "work_tag_list_en")))
                tags_field.clear()
                
                # Tag System Fix using ActionChains
                ActionChains(driver) \
                    .move_to_element(tags_field) \
                    .click() \
                    .send_keys(tags) \
                    .send_keys(Keys.ENTER) \
                    .perform()
                break
            except StaleElementReferenceException:
                logger.warning("Stale element encountered for Tags field. Retrying...")
                time.sleep(1)
            except Exception as e:
                logger.warning(f"ActionChains failed for tags, attempting JS Fallback. Error: {e}")
                try:
                    tags_field = driver.find_element(By.ID, "work_tag_list_en")
                    driver.execute_script("arguments[0].value = arguments[1];", tags_field, tags)
                    ActionChains(driver).send_keys(Keys.ENTER).perform()
                    break
                except Exception as js_err:
                    logger.error(f"JS fallback for tags failed: {js_err}")
                    if attempt == max_retries - 1:
                        raise

        # Handle blocking modals just in case
        try:
            rights_checkbox = driver.find_elements(By.ID, "rightsDeclaration")
            if rights_checkbox and not rights_checkbox[0].is_selected():
                driver.execute_script("arguments[0].click();", rights_checkbox[0])
        except Exception:
            pass

        # ==========================================
        # STEP 4: Final Submission (Button Polling)
        # ==========================================
        logger.info("Step 4: Final Submission.")
        save_btn_locator = (By.ID, "submit-work")
        
        # Button Polling: check every 1 second, max 30 seconds
        button_active = False
        start_time = time.time()
        while time.time() - start_time < 30:
            try:
                save_btn = driver.find_element(*save_btn_locator)
                if not save_btn.get_attribute("disabled"):
                    button_active = True
                    break
            except StaleElementReferenceException:
                pass
            except Exception:
                pass
            time.sleep(1)
            
        if not button_active:
            logger.error("Timeout: Save button stayed disabled for over 30 seconds. Refreshing.")
            driver.refresh()
            return False
        
        # Double check it is fully clickable
        save_button = wait.until(EC.element_to_be_clickable(save_btn_locator))
        
        # Use execute_script to click 'Save Work'
        driver.execute_script("arguments[0].click();", save_button)
        logger.info("'Save Work' clicked.")

        # ==========================================
        # STEP 5: Success Verification
        # ==========================================
        logger.info("Step 5: Success Verification.")
        # Wait until 'Congratulations' banner or Success UI appears
        wait.until(
            lambda d: len(d.find_elements(By.XPATH, "//*[contains(text(), 'Congratulations')]")) > 0 or
                      len(d.find_elements(By.CSS_SELECTOR, ".flash--success, .success-message")) > 0 or
                      "/portfolio/manage" in d.current_url
        )
        logger.info("Design successfully published.")
        
        return True

    except (TimeoutException, ElementNotInteractableException) as e:
        logger.error(f"UI interaction failed for template {template_id}: {type(e).__name__} - {str(e)}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error during duplicate workflow for {template_id}: {str(e)}")
        return False
